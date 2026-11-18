/**
 * The automatic refresh's job, run whole on a thread of its own. The job does the heavy synchronous database work (the
 * window scans, routing, judging, the goals and focus reads, every CLI command), so none of it may run on the worker's
 * main thread, where a long scan holds every HTTP request. Two earlier rounds moved the scans one at a time and each
 * left a read behind on the main thread; moving the job as a whole leaves no database handle there to leave behind.
 *
 * The main thread keeps what is not database work: it drives runAgentTask (the agent processes), it writes the my-focus rows, and it
 * is the request ledger's only writer. The job reaches them through three callbacks, `ask`, `saveFocus` and `writeLedger`, and hands
 * back only small results.
 */

import type { UsableAgentId } from '../agent-runner/detect.js';
import type { AnswerSchema, StepModels } from '../agent-runner/run.js';
import { serializeError, type SerializedError } from '../context/ContextReadProtocol.js';
import { openSqliteDatabase } from '../sqlite/open-database.js';
import { configuredFocusJudge } from './focus-judge.mjs';
import { remoteLedgerWriter, type LedgerWriteOp, type LedgerWriteReply } from './ledger-writes.mjs';
import type { RefreshNeeds } from './request-groups.mjs';
import type { RouterFocusBody } from './my-focus.mjs';
import { configuredJudge } from './request-judge.mjs';
import { buildRefreshTask, type StepTiming } from './refresh-task.js';

/** Everything the job needs, as plain values: the thread never reads DB_PATH, DATA_DIR or the main thread's closures. */
export interface RefreshJobStartInput {
  needs: RefreshNeeds;
  reason: string;
  databasePath: string;
  dataDir: string;
  ledgerDir: string;
  pluginRoot: string;
  /** Read for the judges (Jev), once per job, so a provider change applies to the next refresh. */
  settingsPath: string;
  /** The worker's sync device id as the run began ('' when cloud sync never started). */
  localDeviceId: string;
}

export interface RefreshJobRunInput { agent: UsableAgentId }

/** What one agent's run of the job came to: its result line or its error, and the step timings so far (kept on failure too). */
export interface RefreshJobRunResult {
  result?: string;
  error?: SerializedError;
  steps: StepTiming[];
}

/** What the job asks of the thread that started it. */
export interface RefreshJobCallbacks {
  ask(input: { prompt: string; models: StepModels; schema?: AnswerSchema }): Promise<string>;
  saveFocus(body: RouterFocusBody): Promise<{ placed: number; focusAreaIds: string[] }>;
  /** One change to the request ledger, applied by the requesting thread: the job never writes the ledger's files itself. */
  writeLedger(op: LedgerWriteOp): Promise<LedgerWriteReply>;
}

const BUSY_TIMEOUT_MS = 1500;

export class RefreshJobHost {
  private readonly task: ReturnType<typeof buildRefreshTask>;
  private callbacks: RefreshJobCallbacks | null = null;

  constructor(input: RefreshJobStartInput) {
    this.task = buildRefreshTask({
      needs: input.needs, reason: input.reason, dataDir: input.dataDir, ledgerDir: input.ledgerDir, pluginRoot: input.pluginRoot,
      openDatabase: () => {
        const database = openSqliteDatabase(input.databasePath, { readonly: true, create: false });
        database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
        return database;
      },
      judge: configuredJudge(input.settingsPath), focusJudge: configuredFocusJudge(input.settingsPath),
      localDeviceId: () => input.localDeviceId,
      saveFocus: body => this.requester().saveFocus(body),
      ledger: remoteLedgerWriter({ dir: input.ledgerDir, send: op => this.requester().writeLedger(op) }),
    });
  }

  /** Owner prompts for the goals step; a no-op when the goals are not stale. Errors reject with their own message. */
  async prepare(): Promise<void> {
    await this.task.prepare?.();
  }

  /** Runs the job for one agent. A failure is a result, not a rejection, so the step timings travel with it. */
  async run(agent: UsableAgentId, callbacks: RefreshJobCallbacks): Promise<RefreshJobRunResult> {
    this.callbacks = callbacks;
    try {
      const result = await this.task.run((prompt, models, schema) => callbacks.ask({ prompt, models, ...(schema ? { schema } : {}) }), agent);
      return { result, steps: [...this.task.steps] };
    } catch (error) {
      return { error: serializeError(error), steps: [...this.task.steps] };
    } finally {
      this.callbacks = null;
    }
  }

  private requester(): RefreshJobCallbacks {
    if (!this.callbacks) throw new Error('The refresh job asked its requester outside a run.');
    return this.callbacks;
  }
}
