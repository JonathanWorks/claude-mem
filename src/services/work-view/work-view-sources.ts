import { WorkStateSource, type WorkViewSnapshot } from './data-source.mjs';
import { refreshNeeds, runCli, type LedgerDatabase, type LedgerWriter, type RefreshNeeds } from './request-groups.mjs';
import { openSqliteDatabase } from '../sqlite/open-database.js';
import { existsSync } from 'node:fs';

/** What one work-view read needs to find the right database and ledger, and how to pace its rebuilds. */
export interface WorkViewReadInput {
  databasePath: string;
  ledgerDir: string | null;
  localDeviceId: string;
  pollIntervalMs: number;
  /** Recorded activity alone rebuilds the view at most this often (see WorkStateSource). */
  activityRefreshMs: number;
}

export interface WorkViewRulesResult {
  connected: boolean;
  rules: unknown[];
}

export interface RefreshNeedsInput {
  ledgerDir: string;
  databasePath: string;
  localDeviceId: string;
  now: number;
}

/** The conversations whose newest prompt time the setup screen's work list shows. */
export interface LastPromptsInput {
  databasePath: string;
  /** `[platform, content session id]` pairs. */
  conversations: Array<[string, string]>;
}

/** One refresh-task CLI command: `argv` is `[command, ...args]` as runCli takes them; an input file named in the args is read from disk. */
export interface RefreshCommandInput {
  ledgerDir: string;
  localDeviceId: string;
  now: number;
  argv: string[];
  /** Who writes the ledger for `apply`, `record-progress` and `record-story` (absent: the files, here). */
  ledger?: LedgerWriter | null;
}

/**
 * The commands a refresh run may run: every one reads the database and the ledger folder and writes at most the
 * ledger folder. `record-focus` is here only to check its answer; the worker's main thread saves it (the my-focus write).
 */
export const REFRESH_CLI_COMMANDS: ReadonlySet<string> = new Set([
  'grouping-input', 'apply', 'pending', 'show', 'record-progress', 'focus-input', 'story-input', 'record-story', 'record-focus',
]);

const BUSY_TIMEOUT_MS = 1500;

/** Runs one refresh-task CLI command on `database` and returns what it printed, or, for `record-focus`, the answer it checked and would have saved. */
export async function runRefreshCommand(database: LedgerDatabase, input: RefreshCommandInput): Promise<unknown> {
  if (!REFRESH_CLI_COMMANDS.has(input.argv[0])) throw new TypeError(`The refresh task may not run ${JSON.stringify(input.argv[0])}.`);
  let printed: unknown;
  let checked: unknown;
  await runCli(input.argv, {
    dir: input.ledgerDir, database, now: input.now, localDeviceId: input.localDeviceId,
    print: value => { printed = value; },
    saveFocus: async body => { checked = body; return { placed: 0, focusAreaIds: [] }; },
    ledger: input.ledger ?? null,
  });
  return input.argv[0] === 'record-focus' ? checked : printed;
}

function openReadOnly(databasePath: string) {
  const database = openSqliteDatabase(databasePath, { readonly: true, create: false });
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return database;
}

/**
 * The work view's reads, kept as long-lived state: one WorkStateSource per database and ledger, so its caches (the
 * reduced work state, the built view, the ledger) survive from one read to the next. The context read thread owns
 * one of these, which keeps the scans off the worker's main thread; a route that runs inline owns another.
 * The refresh run's own database work is not here: it runs as a whole on a thread of its own (refresh-job-host.ts).
 */
export class WorkViewSources {
  private readonly sources = new Map<string, WorkStateSource>();

  private sourceFor(input: WorkViewReadInput): WorkStateSource {
    const key = JSON.stringify([input.databasePath, input.ledgerDir, input.pollIntervalMs, input.activityRefreshMs]);
    let source = this.sources.get(key);
    if (!source) {
      source = new WorkStateSource({
        databasePath: input.databasePath,
        ledgerDir: input.ledgerDir,
        pollIntervalMs: input.pollIntervalMs,
        activityRefreshMs: input.activityRefreshMs,
      });
      this.sources.set(key, source);
    }
    source.localDeviceId = input.localDeviceId;
    return source;
  }

  /** The built agent view; `source.connected` is false, with a sanitized error, when the database cannot be read. */
  read(input: WorkViewReadInput): WorkViewSnapshot {
    return this.sourceFor(input).read().agentView;
  }

  /** The saved rules without the activity scan. */
  rules(input: WorkViewReadInput): WorkViewRulesResult {
    return this.sourceFor(input).readRules();
  }

  /** What the automatic refresh would do now. Opens its own read-only connection and closes it. */
  refreshNeeds(input: RefreshNeedsInput): RefreshNeeds {
    const database = openReadOnly(input.databasePath);
    try {
      return refreshNeeds({ dir: input.ledgerDir, database, now: input.now, localDeviceId: input.localDeviceId });
    } finally {
      database.close();
    }
  }

  /** The newest prompt time (epoch ms) of each conversation, in the order given; 0 for one with no prompt, and for every one when there is no database. */
  lastPrompts(input: LastPromptsInput): number[] {
    if (!existsSync(input.databasePath)) return input.conversations.map(() => 0);
    const database = openReadOnly(input.databasePath);
    try {
      const lastPrompt = database.prepare(`SELECT MAX(up.created_at_epoch) AS at FROM user_prompts up JOIN sdk_sessions s ON s.id = up.session_db_id
        WHERE s.platform_source = ? AND s.content_session_id = ?`);
      return input.conversations.map(([platform, id]) => Number((lastPrompt.get(platform, id) as { at: number | null } | null)?.at ?? 0));
    } finally {
      database.close();
    }
  }

  close(): void {
    for (const source of this.sources.values()) source.close();
    this.sources.clear();
  }
}
