import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextReadWorkerClient } from '../../src/services/context/ContextReadWorkerClient.js';
import { runAgentTask, type AgentRunnerDependencies } from '../../src/services/agent-runner/run.js';
import { DATA_DIR } from '../../src/shared/paths.js';
import { openSqliteDatabase } from '../../src/services/sqlite/open-database.js';
import { instrumentSlowQueries } from '../../src/services/sqlite/slow-query-log.js';
import { openStatementWindow } from '../../src/services/sqlite/sql-scope.js';
import { summarizeSql } from '../../src/services/sqlite/sql-text.js';
import { remoteRefreshTask } from '../../src/services/work-view/refresh-job-client.js';
import { buildRefreshTask } from '../../src/services/work-view/refresh-task.js';
import { applyLedgerWrite, type LedgerWriteOp } from '../../src/services/work-view/ledger-writes.mjs';
import { readLedger } from '../../src/services/work-view/request-groups.mjs';
import { workerWorkViewReader, type WorkViewReader } from '../../src/services/work-view/work-view-reader.js';
import { WorkViewRoutes } from '../../src/services/worker/http/routes/WorkViewRoutes.js';
import { everyRequestInOther, focusWriter } from '../helpers/fake-focus-writer.js';
import { watchMainThreadStatements, type AllowedStatement, type WatchOptions } from '../helpers/main-thread-sql-witness.js';
import type { AutoRefreshWorker } from '../../src/services/work-view/auto-refresh-worker.mjs';
import type { RouterFocusBody } from '../../src/services/work-view/my-focus.mjs';

const DAY = 86400000;
const PLUGIN_ROOT = join(import.meta.dir, '..', '..', 'plugin');
/** The EXPLAIN QUERY PLAN steps SQLite gives a statement on `database` (what a reviewer reads before pinning them). */
function planSteps(database: Database, sql: string, params: unknown[]): string[] {
  const statement = database.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  try { return (statement.all(...params as never[]) as Array<{ detail: string }>).map(row => row.detail); } finally { statement.finalize(); }
}
const key = (session: string) => JSON.stringify(['conversation', 'claude', session]);
const NEEDS = { due: 0, ungrouped: 1, goalsStale: false, unplaced: 0, otherChanged: false, needed: true };

/** One conversation that started three days ago, so the 14-day window holds it. Synthetic. */
function fixtureDatabase(now: number): Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, platform_source TEXT, content_session_id TEXT, memory_session_id TEXT, project TEXT, user_prompt TEXT, started_at_epoch INTEGER);
    CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER);
    CREATE TABLE tool_uses (id INTEGER PRIMARY KEY, session_db_id INTEGER, tool_name TEXT, tool_input TEXT, created_at_epoch INTEGER);
    CREATE TABLE observations (id INTEGER PRIMARY KEY, memory_session_id TEXT, type TEXT, title TEXT, subtitle TEXT, created_at_epoch INTEGER);
    CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER);`);
  db.prepare('INSERT INTO sdk_sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 'claude', 'a', 'm1', 'repo/tree', 'Build the release cards', now - 3 * DAY);
  db.prepare('INSERT INTO user_prompts (session_db_id, prompt_number, prompt_text, created_at_epoch) VALUES (?, ?, ?, ?)').run(1, 1, 'Build the release cards', now - 3 * DAY);
  return db;
}

function writeFixtureFile(path: string, now: number): void {
  const database = fixtureDatabase(now);
  writeFileSync(path, database.serialize());
  database.close();
}

/** The answers the agent gives, by the section of the request-progress skill a prompt asks for. */
function answerFor(prompt: string): string {
  if (prompt.includes('Do only section 1')) return JSON.stringify({ groups: [{ title: 'Release cards', conversations: [key('a')] }], ignored: [] });
  if (prompt.includes('Do only section 2')) {
    const [show] = JSON.parse(readFileSync(/is in (\S+\.json)/.exec(prompt)![1], 'utf8'));
    return JSON.stringify({ reviews: [{ groupId: show.groupId, state: 'in-progress', percent: 40, summary: 'Cards are being built.', reviewBasis: show.reviewBasis }] });
  }
  if (prompt.includes('Do only section 3')) return everyRequestInOther(prompt);
  if (prompt.includes('Do only section 4')) return JSON.stringify({ narrative: 'One request is under way.', preferences: [] });
  throw new Error(`Unexpected prompt: ${prompt.slice(-200)}`);
}

/** An agent runner whose one logged-in agent answers each prompt with `answer`, and records every prompt it was asked. */
function fakeAgent(answer: (prompt: string, asked: number) => string | Promise<string>): { dependencies: Partial<AgentRunnerDependencies>; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    dependencies: {
      detect: async () => [{ id: 'claude-code', path: '/not/run/claude', authenticated: true, reason: 'fixture' }],
      buildEnv: async () => ({}),
      query: (({ prompt }: { prompt: string }) => (async function* () {
        prompts.push(prompt);
        yield { type: 'result', subtype: 'success', is_error: false, result: await answer(prompt, prompts.length) };
      })()) as unknown as AgentRunnerDependencies['query'],
    },
  };
}

/** The my-focus write on the fixture database: on the main thread, as in the worker. */
const saveFocusRows = (body: RouterFocusBody) => focusWriterOfFixture.save(body);

/** A job thread that counts how often it was opened and closed. */
class CountingClient extends ContextReadWorkerClient {
  closes = 0;
  override async close(): Promise<void> { this.closes++; await super.close(); }
}

/**
 * The one statement the main thread may run during a refresh: the worker's my-focus write (WorkViewRoutes.recordRouterFocus
 * appends through appendWorkStateEntry), modelled here by an INSERT into the fixture database. Every other statement
 * the instrumentation records on the main thread fails the test.
 */
const FOCUS_INSERT_SQL = 'INSERT INTO work_state_entries (project, list_name, fields, created_at_epoch) VALUES (?, ?, ?, ?)';
/** Built per test: its plan is taken on the fixture's own write connection, which exists only inside a test. */
const mainThreadAllowed = (): AllowedStatement[] => [{
  sql: FOCUS_INSERT_SQL,
  reason: 'the my-focus write is a system-only write to the synced database and stays on the main thread (measured: one row insert per placement)',
  expectedPlan: [],
  writesTables: ['work_state_entries'],
  plan: { database: writeDatabase, params: ['project', 'list', '{}', 0] },
}];

/**
 * The one read the main thread makes per request while a viewer is connected: WorkViewRoutes.snapshot() looks each request up in the
 * review sidecar (LocalReviewStore.read), and a focus write publishes a snapshot. The allowlist names the statement's exact text and the
 * EXACT plan a reviewer approved for it (below); the witness plans it on the sidecar and requires equality, parsing neither SQL nor plan.
 */
const REVIEW_READ_SQL = 'SELECT checked_at_epoch FROM work_view_reviews WHERE request_id = ? AND content_fingerprint = ?';
const REVIEW_READ_REASON = 'snapshot() reads each request\'s review state from the sidecar: one primary-key lookup per request, per publish (measured: microseconds on the synthetic sidecar)';
/** The plan a reviewer approved: request_id is the table's PRIMARY KEY, one row at most, through the auto index SQLite names below. */
const REVIEW_READ_PLAN = ['SEARCH work_view_reviews USING INDEX sqlite_autoindex_work_view_reviews_1 (request_id=?)'];
/** Most milliseconds the allowlisted statements (the review point reads and the my-focus inserts) may add up to on the main thread in one run (synthetic sidecar of REVIEW_SIDECAR_ROWS rows). */
const ALLOWED_BUDGET_MS = 5;
const REVIEW_SIDECAR_ROWS = 5000;
/** Most milliseconds all the run's main-thread SQL may add up to (reads and the my-focus writes). */
const TOTAL_SQL_BUDGET_MS = 25;

/** A browser's open event stream, as far as WorkViewRoutes sees one: a response that takes writes. */
class FakeStream {
  destroyed = false; writableEnded = false; writableLength = 0;
  events: string[] = [];
  write(chunk: string): boolean { this.events.push(chunk.slice(0, chunk.indexOf('\n')).replace('event: ', '')); return true; }
  end(): void { this.writableEnded = true; }
  destroy(): void { this.destroyed = true; }
}

let directory: string;
let databasePath: string;
let writeDatabase: Database;
let focusWriterOfFixture: ReturnType<typeof focusWriter>;
let now: number;
let routes: WorkViewRoutes | null;
let reviewSidecar: Database | null;
const ledgerOfDefaultRefresh = join(DATA_DIR, 'work-view');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'refresh-job-'));
  databasePath = join(directory, 'source.db');
  now = Date.now();
  writeFixtureFile(databasePath, now);
  // The worker's my-focus write, standing in for its own connection: it belongs to the main thread, and is opened before any watch begins.
  writeDatabase = new Database(databasePath);
  writeDatabase.exec('PRAGMA busy_timeout = 1500');
  // The fixture's connection stands in for the worker's own, which is opened through openSqliteDatabase and so is instrumented.
  instrumentSlowQueries(writeDatabase);
  focusWriterOfFixture = focusWriter(writeDatabase, { firstEpoch: now });
  rmSync(ledgerOfDefaultRefresh, { recursive: true, force: true });
  routes = null;
  reviewSidecar = null;
});

afterEach(async () => {
  await routes?.close();
  writeDatabase.close();
  reviewSidecar?.close();
  rmSync(directory, { recursive: true, force: true });
  rmSync(ledgerOfDefaultRefresh, { recursive: true, force: true });
});

describe('a refresh run through WorkViewRoutes', () => {
  /** A reader on a real thread that records the needs scans and answers with the goals fresh (the goals step reads transcripts, not under test here). */
  function spyOnRealReader(calls: string[]): WorkViewReader {
    const inner = workerWorkViewReader();
    return {
      ...inner,
      refreshNeeds: async input => { calls.push('refreshNeeds'); return { ...(await inner.refreshNeeds(input)), goalsStale: false }; },
    };
  }

  /** The default automatic refresh, built by WorkViewRoutes' own constructor: it names no ledger and passes no autoRefresh. */
  function defaultRoutes(options: { readerCalls: string[]; agent: ReturnType<typeof fakeAgent>; clients: CountingClient[]; focusRows: unknown[] }): WorkViewRoutes {
    return new WorkViewRoutes({
      databasePath, reviewPath: join(directory, 'review.db'), setupStatePath: join(directory, 'setup-state.json'), settingsPath: join(directory, 'settings.json'),
      rulesFilePath: join(directory, 'MY-RULES.md'), claudeInstructionsPath: join(directory, 'CLAUDE.md'), homeProject: 'home', humanCopy: null, pollIntervalMs: 600_000,
      reader: spyOnRealReader(options.readerCalls),
      // The my-focus write is the one database write that belongs to the main thread: one row into the fixture.
      appendWorkStateEntry: ({ project, listName, fields }) => {
        options.focusRows.push(fields);
        writeDatabase.prepare(FOCUS_INSERT_SQL).run(project, listName, JSON.stringify(fields), now + options.focusRows.length);
      },
      autoRefreshPlace: { pluginRoot: PLUGIN_ROOT, agentRunner: options.agent.dependencies, createJobClient: () => { const client = new CountingClient(); options.clients.push(client); return client; } },
    });
  }

  const autoRefreshOf = (live: WorkViewRoutes) => (live as unknown as { autoRefresh: AutoRefreshWorker | null }).autoRefresh;

  /**
   * A synthetic review sidecar of realistic size, and a read-only handle on it for EXPLAIN QUERY PLAN. The handle is a plain
   * Database, not an instrumented connection, so what it runs is not recorded as main-thread work.
   */
  function seedReviewSidecar(): Database {
    const sidecar = new Database(join(directory, 'review.db'));
    sidecar.exec('PRAGMA busy_timeout = 1500');
    const insert = sidecar.prepare("INSERT OR REPLACE INTO work_view_reviews (request_id, content_fingerprint, checked_at_epoch, actor) VALUES (?, ?, ?, 'local-user')");
    sidecar.transaction(() => { for (let index = 0; index < REVIEW_SIDECAR_ROWS; index++) insert.run(`synthetic-request-${index}`, `fingerprint-${index}`, now); })();
    return sidecar;
  }

  /** What the routes do while a viewer is connected: the stream is in `clients`, and every publish is tracked so the run can wait for it. */
  function connectViewer(live: WorkViewRoutes): { stream: FakeStream; publishes: Promise<void>[] } {
    const internals = live as unknown as { clients: Set<unknown>; publish: (...args: unknown[]) => Promise<void> };
    const stream = new FakeStream();
    internals.clients.add(stream);
    const publishes: Promise<void>[] = [];
    const publish = internals.publish.bind(live);
    internals.publish = (...args) => { const pending = publish(...args); publishes.push(pending); return pending; };
    return { stream, publishes };
  }

  /**
   * One default refresh with the main thread's statements watched, WITH a viewer connected (the automatic refresh only runs while one is,
   * so this is the configuration production has). `probe` runs on the main thread inside the run (when the first agent question
   * arrives), standing for code that queries a database from here.
   */
  async function runWatched(options: { agent?: ReturnType<typeof fakeAgent>; allowed?: AllowedStatement[]; probe?: (live: WorkViewRoutes) => void } = {}) {
    const readerCalls: string[] = [];
    const clients: CountingClient[] = [];
    const focusRows: unknown[] = [];
    let probed = false;
    const agent = options.agent ?? fakeAgent((prompt, asked) => {
      if (options.probe && asked === 1 && !probed) { probed = true; options.probe(routes!); }
      return answerFor(prompt);
    });
    routes = defaultRoutes({ readerCalls, agent, clients, focusRows });
    const refresh = autoRefreshOf(routes);
    // F6: the constructor built the default refresh. Without the needs handoff it would scan on this thread, on its own handle.
    expect(refresh).not.toBeNull();
    reviewSidecar = seedReviewSidecar();
    const viewer = connectViewer(routes);
    const allowed = options.allowed ?? [...mainThreadAllowed(), { sql: REVIEW_READ_SQL, reason: REVIEW_READ_REASON, expectedPlan: REVIEW_READ_PLAN, plan: { database: reviewSidecar, params: ['synthetic-request-1', 'fingerprint-1'] } }];
    const witness = watchMainThreadStatements(allowed, { maxAllowedMs: ALLOWED_BUDGET_MS });
    let outcome: Awaited<ReturnType<AutoRefreshWorker['runNow']>>;
    let main: ReturnType<typeof witness.finish>;
    try {
      outcome = await refresh!.runNow({ reason: 'test' });
      // The focus write publishes without being awaited: let every publish the run caused finish before the watch ends.
      await Promise.all(viewer.publishes);
    } finally { main = witness.finish(); }
    return { outcome, main, readerCalls, clients, focusRows, agent, refresh: refresh!, probed, viewer };
  }

  it('runs every database read and write of the run on the job thread: the main thread runs the my-focus write and nothing else', async () => {
    const { outcome, main, readerCalls, clients, focusRows, agent, refresh, viewer } = await runWatched();

    // PROPOSITION: every statement the SQL instrumentation recorded on this thread, scoped or not, is on the reviewed allowlist.
    expect(main.unexpected).toEqual([]);
    // EXECUTION: the instrumentation was live for the run (it saw the my-focus write, as many times as rows were written).
    const write = main.seen.find(entry => entry.sql === FOCUS_INSERT_SQL);
    expect(write).toEqual({ sql: FOCUS_INSERT_SQL, count: 2 * focusRows.length });
    // EXECUTION: a viewer was connected, the focus write published a snapshot to it, and that snapshot read the review sidecar on this
    // thread: the read the allowlist holds is one the run really made (each statement counts twice: prepare, then get).
    expect(viewer.publishes.length).toBeGreaterThan(0);
    expect(viewer.stream.events).toContain('work-view');
    const reviewReads = main.seen.find(entry => entry.sql === REVIEW_READ_SQL);
    expect(reviewReads?.count).toBeGreaterThanOrEqual(2);
    // PROPOSITION: nothing else ran on this thread, and the one read goes through the unique key its entry names, within its time budget.
    expect(main.seen.map(entry => entry.sql).sort()).toEqual([FOCUS_INSERT_SQL, REVIEW_READ_SQL].sort());
    // EXECUTION: every entry was planned: the insert has no plan step, the review read is one SEARCH on its unique index.
    expect([...main.plans].sort((a, b) => a.sql.localeCompare(b.sql))).toEqual([
      { sql: FOCUS_INSERT_SQL, steps: [] },
      { sql: REVIEW_READ_SQL, steps: REVIEW_READ_PLAN },
    ]);
    expect(main.allowedMs).toBeLessThan(ALLOWED_BUDGET_MS);
    // All of the run's SQL on this thread, the my-focus inserts included (measured about 1 ms), stays far under one event-loop stall.
    expect(main.sqlMs).toBeLessThan(TOTAL_SQL_BUDGET_MS);

    // The run happened, through the reader's needs scan and a job thread, and its work landed.
    expect(outcome).toBe('ok');
    expect(readerCalls).toEqual(['refreshNeeds']);
    expect(clients.length).toBe(1);
    expect(agent.prompts.length).toBeGreaterThanOrEqual(4);
    expect(Object.values(readLedger(ledgerOfDefaultRefresh).groups.groups).map((group: any) => group.title)).toEqual(['Release cards']);
    expect(readLedger(ledgerOfDefaultRefresh).story.narrative).toBe('One request is under way.');
    expect(focusRows.length).toBeGreaterThan(0);
    const status = refresh.status()!;
    expect(status.state).toBe('ok');
    expect(status.result).toBe('1 new conversations grouped, 1 requests reviewed, 1 requests placed, story written.');
    expect(status.steps!.map(step => step.step)).toEqual(expect.arrayContaining(['grouping', 'review', 'focus', 'story']));
    // The job's thread was ended with the run.
    expect(clients[0].closes).toBe(1);
  }, 30_000);

  it('hands the ten-minute needs scan to the reader: the check reads through it and runs no statement on the main thread', async () => {
    const agent = fakeAgent(answerFor);
    agent.dependencies.detect = async () => [];
    const { outcome, main, readerCalls, clients } = await runWatched({ agent, allowed: [] });
    // EXECUTION: the scan ran and found work to do (it went on to look for an agent, which there is none of).
    expect(outcome).toBe('waiting-for-agent');
    expect(readerCalls).toEqual(['refreshNeeds']);
    expect(main.total).toBe(0);
    expect(main.unexpected).toEqual([]);
    expect(clients).toEqual([]);
  }, 20_000);

  describe('the witness fails on each way the main thread could read during the run', () => {
    it('a connection opened BEFORE the watch and queried during the run (the shape the Database.prototype patch missed)', async () => {
      const preOpened = openSqliteDatabase(databasePath, { readonly: true, create: false });
      try {
        let answered: unknown = null;
        const { main, outcome, probed } = await runWatched({ probe: () => { answered = preOpened.prepare('SELECT count(*) AS n FROM sdk_sessions').get(); } });
        // EXECUTION: the probe ran inside the run, read a row, and the run still finished.
        expect(probed).toBe(true);
        expect(answered).toEqual({ n: 1 });
        expect(outcome).toBe('ok');
        expect(main.unexpected).toContain('SELECT count(*) AS n FROM sdk_sessions');
      } finally { preOpened.close(); }
    }, 30_000);

    it('LocalReviewStore.read during the run', async () => {
      let review: unknown = null;
      // The review read is allowlisted for the real run (by its unique key); with it off the allowlist the same read is a failure.
      const { main, probed } = await runWatched({
        allowed: mainThreadAllowed(),
        probe: live => { review = (live as unknown as { reviews: { read(id: string, fingerprint: string): unknown } }).reviews.read('request-a', 'fingerprint-a'); },
      });
      expect(probed).toBe(true);
      // The read reached the database (available), so the witness had a statement to see.
      expect(review).toMatchObject({ available: true, checked: false });
      expect(main.unexpected.some(sql => sql.includes('FROM work_view_reviews'))).toBe(true);
    }, 30_000);

    it('a statement outside the allowlist on the SAME connection as an allowlisted one', async () => {
      const { main } = await runWatched({ probe: () => { writeDatabase.prepare('SELECT count(*) AS n FROM work_state_entries').get(); } });
      expect(main.unexpected).toEqual(['SELECT count(*) AS n FROM work_state_entries']);
    }, 30_000);
  });

  describe('the witness pins each allowlisted statement to the exact plan a reviewer approved, and classifies nothing', () => {
    const SCHEMA = `CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, team INTEGER);
      CREATE INDEX people_name ON people (name);
      CREATE TABLE reviews (request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, at INTEGER);
      CREATE UNIQUE INDEX reviews_key ON reviews (request_id, fingerprint);
      CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT UNIQUE)`;
    const PK_EQUALITY = ['SEARCH people USING INTEGER PRIMARY KEY (rowid=?)'];
    const KEY_EQUALITY = ['SEARCH reviews USING INDEX reviews_key (request_id=? AND fingerprint=?)'];
    const BY_ID = 'SELECT name FROM people WHERE id = ?';
    const INSERT = 'INSERT INTO people (id, name, team) VALUES (?, ?, ?)';
    const BUDGET = { maxAllowedMs: 1000 };
    /** An instrumented connection (what the worker runs) and a plain one on the same schema (what EXPLAIN QUERY PLAN runs on), both with 1000 rows per table. */
    function connections(extraSchema = '') {
      const planner = new Database(':memory:');
      const worker = instrumentSlowQueries(new Database(':memory:'));
      for (const database of [planner, worker]) {
        database.exec(SCHEMA);
        if (extraSchema) database.exec(extraSchema);
        for (let id = 1; id <= 1000; id++) {
          database.prepare('INSERT INTO people (id, name, team) VALUES (?, ?, ?)').run(id, `n${id % 10}`, id % 3);
          database.prepare('INSERT INTO reviews (request_id, fingerprint, at) VALUES (?, ?, ?)').run(`r${id}`, `f${id}`, id);
          database.prepare('INSERT INTO tags (id, label) VALUES (?, ?)').run(id, `l${id}`);
        }
      }
      return { planner, worker };
    }
    /** Runs the entry's statement once on the worker's connection under an allowlist holding that entry (its plan taken on the planner's), and reports what the witness says. */
    function watch(entry: Omit<AllowedStatement, 'plan'> & { params: unknown[]; runSql?: string }, options: Partial<WatchOptions> = {}, extraSchema = '') {
      const { planner, worker } = connections(extraSchema);
      const { params, runSql, ...allowed } = entry;
      const witness = watchMainThreadStatements([{ ...allowed, plan: { database: planner, params } }], { ...BUDGET, ...options });
      // EXECUTION: the statement ran (it was recorded), so the verdict is about a statement that was made.
      worker.prepare(runSql ?? entry.sql).all(...params as never[]);
      const main = witness.finish();
      planner.close(); worker.close();
      return main;
    }
    const drift = (sql: string, pinned: string[], now: string[]) => `plan drifted from the pinned one (pinned: [${pinned.join('; ')}], now: [${now.join('; ')}]): ${sql}`;

    it('accepts a statement whose plan equals the pinned one, a plain INSERT ... VALUES with no trigger on its table, and reports their plans', () => {
      const byId = watch({ sql: BY_ID, reason: 'test', expectedPlan: PK_EQUALITY, params: [1] });
      expect(byId.unexpected).toEqual([]);
      expect(byId.seen).toEqual([{ sql: BY_ID, count: 2 }]);
      expect(byId.plans).toEqual([{ sql: BY_ID, steps: PK_EQUALITY }]);
      const byKey = watch({ sql: 'SELECT at FROM reviews WHERE request_id = ? AND fingerprint = ?', reason: 'test', expectedPlan: KEY_EQUALITY, params: ['r1', 'f1'] });
      expect(byKey.unexpected).toEqual([]);
      const byLabel = watch({ sql: 'SELECT id FROM tags WHERE label = ?', reason: 'test', expectedPlan: ['SEARCH tags USING COVERING INDEX sqlite_autoindex_tags_1 (label=?)'], params: ['l1'] });
      expect(byLabel.unexpected).toEqual([]);
      const insert = watch({ sql: INSERT, reason: 'test', expectedPlan: [], writesTables: ['people'], params: [5000, 'x', 1] });
      expect(insert.unexpected).toEqual([]);
      expect(insert.plans).toEqual([{ sql: INSERT, steps: [] }]);
    });

    it('fails a range read whose text hides the range: a trailing comment, a block comment, a quoted alias', () => {
      // Each text carries an `id = ?` that a reader of the SQL (or a regex over it) would take for the binding; only the plan says what is read.
      const RANGE_PLAN = ['SEARCH people USING INTEGER PRIMARY KEY (rowid>?)'];
      for (const sql of [
        'SELECT name FROM people WHERE id > ? -- AND id = ?',
        'SELECT name FROM people WHERE id > ? /* AND id = ? */',
        'SELECT name AS "WHERE id = ?" FROM people WHERE id > ?',
      ]) {
        const main = watch({ sql, reason: 'test', expectedPlan: PK_EQUALITY, params: [0] });
        // EXECUTION: the entry was planned (a range SEARCH of the key: 1000 rows read) and the pinned equality is not what it got.
        expect(main.plans).toEqual([{ sql: summarizeSql(sql), steps: RANGE_PLAN }]);
        expect(main.unexpected).toEqual([drift(summarizeSql(sql), PK_EQUALITY, RANGE_PLAN)]);
      }
    });

    it('fails a CTE range, a BETWEEN and a scan, however small the table, when the pinned plan is a point read', () => {
      const CTE = 'WITH p AS (SELECT * FROM people) SELECT name FROM p WHERE id > ?';
      expect(watch({ sql: CTE, reason: 'test', expectedPlan: PK_EQUALITY, params: [0] }).unexpected)
        .toEqual([drift(CTE, PK_EQUALITY, ['SEARCH people USING INTEGER PRIMARY KEY (rowid>?)'])]);
      const BETWEEN = 'SELECT name FROM people WHERE id BETWEEN ? AND ?';
      expect(watch({ sql: BETWEEN, reason: 'test', expectedPlan: PK_EQUALITY, params: [1, 5] }).unexpected)
        .toEqual([drift(BETWEEN, PK_EQUALITY, ['SEARCH people USING INTEGER PRIMARY KEY (rowid>? AND rowid<?)'])]);
      const HOT = '/* hot */ SELECT name FROM people WHERE team = ?';
      expect(watch({ sql: HOT, reason: 'test', expectedPlan: PK_EQUALITY, params: [1] }).unexpected).toEqual([drift(summarizeSql(HOT), PK_EQUALITY, ['SCAN people'])]);
    });

    it('fails an equality on a NON-unique index when the pinned plan is the primary-key point read', () => {
      const BY_NAME = 'SELECT id FROM people WHERE name = ?';
      const main = watch({ sql: BY_NAME, reason: 'test', expectedPlan: PK_EQUALITY, params: ['n1'] });
      // The plan does SEARCH an index with an equality, one it is not: 100 rows match.
      expect(main.plans[0].steps[0]).toMatch(/^SEARCH people USING (COVERING )?INDEX people_name \(name=\?\)$/);
      expect(main.unexpected).toEqual([drift(BY_NAME, PK_EQUALITY, main.plans[0].steps)]);
    });

    it('fails a unique composite index read by a prefix, a range on its last column, or the last column alone', () => {
      const probe = (sql: string, params: unknown[]) => watch({ sql, reason: 'test', expectedPlan: KEY_EQUALITY, params }).unexpected;
      for (const [sql, params] of [
        ['SELECT at FROM reviews WHERE request_id = ?', ['r1']],
        ['SELECT at FROM reviews WHERE request_id = ? AND fingerprint > ?', ['r1', 'a']],
        ['SELECT at FROM reviews WHERE fingerprint = ?', ['f1']],
        ['SELECT at FROM reviews WHERE request_id = ? OR fingerprint = ?', ['r1', 'f2']],
      ] as Array<[string, unknown[]]>) expect(probe(sql, params)).toEqual([expect.stringContaining('plan drifted from the pinned one')]);
    });

    it('fails when the plan drifts after the entry was approved: the index it pinned is gone', () => {
      const BY_NAME = 'SELECT id FROM people WHERE name = ?';
      const { planner, worker } = connections();
      const pinned = planSteps(planner, BY_NAME, ['n1']);
      expect(pinned[0]).toMatch(/INDEX people_name \(name=\?\)$/);
      planner.exec('DROP INDEX people_name');
      const witness = watchMainThreadStatements([{ sql: BY_NAME, reason: 'test', expectedPlan: pinned, plan: { database: planner, params: ['n1'] } }], BUDGET);
      worker.prepare(BY_NAME).get('n1');
      expect(witness.finish().unexpected).toEqual([drift(BY_NAME, pinned, ['SCAN people'])]);
      planner.close(); worker.close();
    });

    it('fails an empty-plan entry whose table holds a trigger: the body is work the plan does not show', () => {
      const TRIGGER = 'CREATE TRIGGER people_after AFTER INSERT ON people BEGIN DELETE FROM tags WHERE id < 500; END';
      const main = watch({ sql: INSERT, reason: 'test', expectedPlan: [], writesTables: ['people'], params: [5000, 'x', 1] }, {}, TRIGGER);
      expect(main.unexpected).toEqual([
        `table people has trigger people_after, whose body this plan does not show: ${INSERT}`,
        expect.stringContaining('not a bare single-row insert'),
      ]);
      // A TEMP trigger is a trigger too.
      const temp = watch({ sql: INSERT, reason: 'test', expectedPlan: [], writesTables: ['people'], params: [5000, 'x', 1] }, {}, 'CREATE TEMP TRIGGER people_temp AFTER INSERT ON people BEGIN DELETE FROM tags; END');
      expect(temp.unexpected[0]).toBe(`table people has trigger people_temp, whose body this plan does not show: ${INSERT}`);
    });

    it('fails an empty-plan entry that is a PRAGMA, a DELETE without WHERE, or names no table it writes', () => {
      for (const [sql, params] of [['PRAGMA user_version', []], ['PRAGMA user_version = 7', []], ['DELETE FROM tags', []], ['VACUUM', []]] as Array<[string, unknown[]]>) {
        const main = watch({ sql, reason: 'test', expectedPlan: [], writesTables: ['tags'], params, runSql: sql === 'VACUUM' ? 'SELECT 1' : sql }, { maxAllowedMs: 1000 });
        expect(main.unexpected.some(line => line.startsWith('empty plan, but the statement is not a bare single-row insert')), sql).toBe(true);
      }
      const noTable = watch({ sql: INSERT, reason: 'test', expectedPlan: [], params: [5000, 'x', 1] });
      expect(noTable.unexpected).toEqual([`allowlisted statement has an empty plan and names no table it writes (writesTables): ${INSERT}`]);
    });

    it('fails an entry with no pinned plan, no plan database, or text too long to be matched exactly', () => {
      const { planner, worker } = connections();
      const noPin = watchMainThreadStatements([{ sql: BY_ID, reason: 'test', plan: { database: planner, params: [1] } } as unknown as AllowedStatement], BUDGET);
      worker.prepare(BY_ID).get(1);
      expect(noPin.finish().unexpected).toEqual([`allowlisted statement pins no expected plan: ${BY_ID}`]);
      const noDatabase = watchMainThreadStatements([{ sql: BY_ID, reason: 'test', expectedPlan: PK_EQUALITY } as unknown as AllowedStatement], BUDGET);
      worker.prepare(BY_ID).get(1);
      expect(noDatabase.finish().unexpected).toEqual([`allowlisted statement has no query plan database: ${BY_ID}`]);
      const LONG = `SELECT /* ${'x'.repeat(300)} */ name FROM people WHERE id = ?`;
      const tooLong = watchMainThreadStatements([{ sql: LONG, reason: 'test', expectedPlan: PK_EQUALITY, plan: { database: planner, params: [1] } }], BUDGET);
      worker.prepare(LONG).get(1);
      expect(tooLong.finish().unexpected).toEqual([expect.stringContaining('too long to match exactly')]);
      planner.close(); worker.close();
    });

    it('refuses to start without a time budget: none, undefined or not a number', () => {
      for (const options of [undefined, {}, { maxAllowedMs: undefined }, { maxAllowedMs: Number.NaN }, { maxAllowedMs: '5' }]) {
        expect(() => watchMainThreadStatements([], options as unknown as WatchOptions), JSON.stringify(options)).toThrow(/maxAllowedMs/);
      }
    });

    it('fails a write that scans, and a statement SQLite cannot plan', () => {
      const COPY = "INSERT INTO tags (id, label) SELECT id + 5000, label || 'x' FROM tags";
      const copy = watch({ sql: COPY, reason: 'test', expectedPlan: [], writesTables: ['tags'], params: [] });
      expect(copy.unexpected).toEqual([expect.stringContaining('plan drifted from the pinned one (pinned: [], now: [SCAN')]);
      const BROKEN = 'SELECT FROM WHERE';
      const { planner, worker } = connections();
      const broken = watchMainThreadStatements([{ sql: BROKEN, reason: 'test', expectedPlan: [], plan: { database: planner, params: [] } }], BUDGET);
      expect(() => worker.prepare(BROKEN)).toThrow();
      expect(broken.finish().unexpected).toEqual([expect.stringContaining('allowlisted statement cannot be planned (')]);
      planner.close(); worker.close();
    });

    it('counts a write toward the time budget as well as a read (every entry counts, also one whose plan has no step)', () => {
      const { planner, worker } = connections();
      const witness = watchMainThreadStatements([{ sql: INSERT, reason: 'test', expectedPlan: [], writesTables: ['people'], plan: { database: planner, params: [5000, 'x', 1] } }], { maxAllowedMs: 0 });
      // Busy time is recorded in whole milliseconds: enough plain inserts that their sum rounds to at least one.
      const insert = worker.prepare(INSERT);
      for (let id = 5000; id < 45000; id++) insert.run(id, 'x', 1);
      const main = witness.finish();
      // EXECUTION: the writes ran and were timed, and the entry's plan has no step, so only a count of every allowlisted statement sees them.
      expect(main.plans).toEqual([{ sql: INSERT, steps: [] }]);
      expect(main.allowedMs).toBeGreaterThan(0);
      expect(main.unexpected).toEqual([expect.stringMatching(/allowlisted statements took .* ms on this thread, over the 0 ms budget/)]);
      planner.close(); worker.close();
    });

    it('fails when the reads add up to more than the budget', () => {
      const main = watch({ sql: BY_ID, reason: 'test', expectedPlan: PK_EQUALITY, params: [1] }, { maxAllowedMs: -1 });
      expect(main.unexpected).toEqual([expect.stringMatching(/allowlisted statements took .* ms on this thread, over the -1 ms budget/)]);
    });

    it('names a statement that is not on the allowlist, and one that differs from an entry by a single character', () => {
      const { planner, worker } = connections();
      const witness = watchMainThreadStatements([{ sql: BY_ID, reason: 'test', expectedPlan: PK_EQUALITY, plan: { database: planner, params: [1] } }], BUDGET);
      worker.prepare(BY_ID).get(1);
      worker.prepare('SELECT name FROM people WHERE name = ?').get('x');
      worker.prepare('SELECT name FROM people WHERE id = ?;').get(1);
      // The order the witness lists them in is not part of its contract; both statements must be named.
      expect([...witness.finish().unexpected].sort()).toEqual(['SELECT name FROM people WHERE id = ?;', 'SELECT name FROM people WHERE name = ?']);
      planner.close(); worker.close();
    });
  });

  it('the witness refuses to report when its statement window was replaced during the watch', () => {
    const witness = watchMainThreadStatements([], { maxAllowedMs: ALLOWED_BUDGET_MS });
    openStatementWindow(1000).close();
    expect(() => witness.finish()).toThrow(/canary/);
  });

  it('the witness fails when the same run happens on the main thread', async () => {
    const witness = watchMainThreadStatements(mainThreadAllowed(), { maxAllowedMs: ALLOWED_BUDGET_MS });
    const ledgerDir = join(directory, 'ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const task = buildRefreshTask({
      localDeviceId: () => '', needs: NEEDS, reason: 'control', dataDir: directory, ledgerDir, pluginRoot: PLUGIN_ROOT, now: () => now,
      openDatabase: () => openSqliteDatabase(databasePath, { readonly: true, create: false }),
      saveFocus: saveFocusRows,
    });
    await task.run(async prompt => answerFor(prompt), 'claude-code');
    const main = witness.finish();
    expect(main.total).toBeGreaterThan(0);
    expect(main.unexpected.some(sql => sql.startsWith('SELECT'))).toBe(true);
  });
});

describe('the job thread, from the main thread', () => {
  function settings(ledgerDir: string) {
    return { databasePath, dataDir: directory, ledgerDir, pluginRoot: PLUGIN_ROOT, settingsPath: join(directory, 'settings.json') };
  }

  async function runJob(options: { agent: ReturnType<typeof fakeAgent>; saveFocus: (body: RouterFocusBody) => { placed: number; focusAreaIds: string[] }; clients?: CountingClient[]; ledgerOps?: LedgerWriteOp[]; ledgerDir?: string; applyOnMain?: (op: LedgerWriteOp) => ReturnType<typeof applyLedgerWrite> }) {
    const ledgerDir = options.ledgerDir ?? join(directory, 'ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const task = remoteRefreshTask({
      needs: NEEDS, reason: 'test', localDeviceId: '', settings: settings(ledgerDir), saveFocus: options.saveFocus,
      writeLedger: async op => { options.ledgerOps?.push(op); return (options.applyOnMain ?? (sent => applyLedgerWrite(ledgerDir, sent)))(op); },
      createClient: () => { const client = new CountingClient(); options.clients?.push(client); return client; },
    });
    try { return { run: await runAgentTask(task, options.agent.dependencies), task }; }
    finally { await task.close(); }
  }

  it('re-asks the focus step when the main thread\'s write refuses with a TypeError', async () => {
    const refused = fakeAgent(answerFor);
    let writes = 0;
    const first = await runJob({
      agent: refused,
      saveFocus: body => {
        writes++;
        if (writes === 1) throw new TypeError('The area is dismissed.');
        return saveFocusRows(body);
      },
    });
    expect(first.run.state).toBe('ok');
    // The refused write, its retry, and the Other pass's write.
    expect(writes).toBe(3);
    const focusPrompts = refused.prompts.filter(prompt => prompt.includes('Do only section 3'));
    expect(focusPrompts.some(prompt => prompt.includes('Your previous answer was refused: The area is dismissed.'))).toBe(true);
  }, 30_000);

  it('does not re-ask the focus step when the main thread\'s write fails any other way, and reports the failure', async () => {
    const failed = fakeAgent(answerFor);
    let attempts = 0;
    const second = await runJob({ agent: failed, saveFocus: () => { attempts++; throw new Error('disk full'); } });
    // The focus step's failure is reported after the story ran; a plain Error is never retried.
    expect(attempts).toBe(1);
    expect(second.run.state).toBe('failed');
    expect(second.run.error).toContain('disk full');
  }, 30_000);

  it('keeps the step timings of a failed run and its message, and ends the thread', async () => {
    const clients: CountingClient[] = [];
    const agent = fakeAgent(prompt => { if (prompt.includes('Do only section 2')) throw new Error('Agent exploded'); return answerFor(prompt); });
    const { run, task } = await runJob({ agent, saveFocus: saveFocusRows, clients });
    expect(run.state).toBe('failed');
    expect(run.error).toContain('Agent exploded');
    // The steps that ran before the failure came back with it (grouping finished, review began).
    expect(task.steps.map(step => step.step)).toEqual(expect.arrayContaining(['grouping', 'review']));
    expect(clients.length).toBe(1);
    expect(clients[0].closes).toBe(1);
  }, 30_000);

  it('sends every change to the request ledger to the main thread as a message: the job thread writes no ledger file itself', async () => {
    const ledgerOps: LedgerWriteOp[] = [];
    const { run } = await runJob({ agent: fakeAgent(answerFor), saveFocus: saveFocusRows, ledgerOps });
    // EXECUTION: the run finished, and its grouping, progress review and story each reached the main thread as a message. A write made
    // on the job thread itself would have thrown (LEDGER_OFF_MAIN_THREAD) and failed this run.
    expect(run.state).toBe('ok');
    expect(ledgerOps.map(op => op.kind)).toEqual(expect.arrayContaining(['apply', 'progress', 'story']));
    const ledger = readLedger(join(directory, 'ledger'));
    expect(Object.values(ledger.groups.groups).map((group: any) => group.title)).toEqual(['Release cards']);
    expect(Object.values(ledger.progress).map((review: any) => review.state)).toEqual(['in-progress']);
    expect(ledger.story.narrative).toBe('One request is under way.');
    // The merge's facts travelled with the change: the main thread opened no database.
    const apply = ledgerOps.find(op => op.kind === 'apply') as Extract<LedgerWriteOp, { kind: 'apply' }>;
    expect(apply.facts?.projects?.[key('a')]).toBe('repo/tree');
  }, 30_000);

  it('reads the facts the main thread says it lacks and sends the change again, once, with them', async () => {
    const ledgerOps: LedgerWriteOp[] = [];
    let stripped = false;
    const ledgerDir = join(directory, 'ledger');
    const { run } = await runJob({
      agent: fakeAgent(answerFor), saveFocus: saveFocusRows, ledgerOps, ledgerDir,
      applyOnMain: op => {
        // The first `apply` arrives without its facts, as when the ledger changed between the job's read and the main thread's merge.
        if (op.kind === 'apply' && !stripped) { stripped = true; return applyLedgerWrite(ledgerDir, { ...op, facts: { projects: {}, anchorAsks: {} } }); }
        return applyLedgerWrite(ledgerDir, op);
      },
    });
    expect(stripped).toBe(true);
    expect(run.state).toBe('ok');
    // The change was sent with its prefetched facts, refused for lack of them, and sent again with the missing ones.
    const applies = ledgerOps.filter(op => op.kind === 'apply') as Array<Extract<LedgerWriteOp, { kind: 'apply' }>>;
    expect(applies).toHaveLength(2);
    expect(applies[1].facts?.projects?.[key('a')]).toBe('repo/tree');
    expect(Object.values(readLedger(ledgerDir).groups.groups).map((group: any) => group.title)).toEqual(['Release cards']);
  }, 30_000);

  it('re-asks the grouping step when the main thread refuses the decisions with a TypeError', async () => {
    const agent = fakeAgent(answerFor);
    let refused = false;
    const ledgerDir = join(directory, 'ledger');
    const { run } = await runJob({
      agent, saveFocus: saveFocusRows, ledgerDir,
      applyOnMain: op => {
        if (op.kind === 'apply' && !refused) { refused = true; throw new TypeError('Decisions refused by the ledger.'); }
        return applyLedgerWrite(ledgerDir, op);
      },
    });
    expect(refused).toBe(true);
    expect(run.state).toBe('ok');
    expect(agent.prompts.some(prompt => prompt.includes('Your previous answer was refused: Decisions refused by the ledger.'))).toBe(true);
  }, 30_000);

  it('refuses a run on a thread that was never started, loudly', async () => {
    const client = new ContextReadWorkerClient();
    try {
      const refused = await client.refreshJobRun({ agent: 'claude-code' }, { ask: async () => '', saveFocus: async () => ({ placed: 0, focusAreaIds: [] }), writeLedger: async () => ({ done: null as never }) })
        .then(() => 'resolved', (error: Error) => error.message);
      expect(refused).toBe('The refresh job was not started on this thread.');
    } finally { await client.close(); }
  }, 20_000);

  it('has a prepare step only when the goals are stale, and starts no thread until a step is run', () => {
    const clients: CountingClient[] = [];
    const build = (goalsStale: boolean) => remoteRefreshTask({
      needs: { ...NEEDS, goalsStale }, reason: 'test', localDeviceId: '', settings: settings(join(directory, 'ledger')), saveFocus: saveFocusRows,
      writeLedger: async op => applyLedgerWrite(join(directory, 'ledger'), op),
      createClient: () => { const client = new CountingClient(); clients.push(client); return client; },
    });
    expect(build(false).prepare).toBeUndefined();
    expect(typeof build(true).prepare).toBe('function');
    expect(clients).toEqual([]);
  });

  it('starts no thread when no agent is logged in', async () => {
    const clients: CountingClient[] = [];
    const none = fakeAgent(answerFor);
    none.dependencies.detect = async () => [];
    const { run } = await runJob({ agent: none, saveFocus: () => ({ placed: 0, focusAreaIds: [] }), clients });
    expect(run.state).toBe('waiting-for-agent');
    expect(clients).toEqual([]);
    expect(existsSync(join(directory, 'ledger', 'request-groups.json'))).toBe(false);
  });
});

describe('the reader thread\'s prompt times', () => {
  it('answers the newest prompt of each conversation, 0 for one without, and 0 for all when there is no database', async () => {
    const reader = workerWorkViewReader();
    try {
      const times = await reader.lastPrompts({ databasePath, conversations: [['claude', 'a'], ['claude', 'unknown']] });
      expect(times).toEqual([now - 3 * DAY, 0]);
      expect(await reader.lastPrompts({ databasePath: join(directory, 'missing.db'), conversations: [['claude', 'a']] })).toEqual([0]);
    } finally { await reader.close(); }
  }, 20_000);
});
