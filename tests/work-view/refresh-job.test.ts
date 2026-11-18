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
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { LocalReviewStore } from '../../src/services/work-view/review-store.js';
import { remoteRefreshTask } from '../../src/services/work-view/refresh-job-client.js';
import { buildRefreshTask } from '../../src/services/work-view/refresh-task.js';
import { applyLedgerWrite, type LedgerWriteOp } from '../../src/services/work-view/ledger-writes.mjs';
import { groupIdFor, readLedger } from '../../src/services/work-view/request-groups.mjs';
import { workerWorkViewReader, type WorkViewReader } from '../../src/services/work-view/work-view-reader.js';
import { CloudSync } from '../../src/services/sync/CloudSync.js';
import { WorkViewRoutes } from '../../src/services/worker/http/routes/WorkViewRoutes.js';
import { everyRequestInOther, focusWriter } from '../helpers/fake-focus-writer.js';
import { explainOn, triggersOn, watchMainThreadStatements, type MainThreadStatements } from '../helpers/main-thread-sql-witness.js';
import type { AutoRefreshWorker } from '../../src/services/work-view/auto-refresh-worker.mjs';
import { MY_FOCUS_LIST, OTHER_FOCUS_AREA_ID, placementRowFields, type RouterFocusBody } from '../../src/services/work-view/my-focus.mjs';

const DAY = 86400000;
const PLUGIN_ROOT = join(import.meta.dir, '..', '..', 'plugin');
const key = (session: string) => JSON.stringify(['conversation', 'claude', session]);
const SYNTHETIC_DEVICE_ID = 'synthetic-device';
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
 * The two statements the main thread runs during a refresh with a viewer connected, and nothing else:
 *  - the worker's my-focus write (WorkViewRoutes.recordRouterFocus appends through appendWorkStateEntry, which worker-service wires to
 *    SessionStore.appendWorkStateEntry). The run here uses that very method, on a synthetic database, as the writer; its statement text
 *    is never typed in this file: `focusWriteSql` is what one call of it was RECORDED to run (see `recordFocusWrite`);
 *  - the one read per request that WorkViewRoutes.snapshot() makes in the review sidecar (LocalReviewStore.read), once per publish.
 * The run's recorded statements are compared with exactly these two texts (see `offList`); no SQL and no plan is parsed or classified.
 */
const REVIEW_READ_SQL = 'SELECT checked_at_epoch FROM work_view_reviews WHERE request_id = ? AND content_fingerprint = ?';
/** Every time an instrumented statement is prepared and then run, the window counts it twice. */
const COUNTS_PER_STATEMENT = 2;
/** The plan of the review read, pinned: request_id is the table's PRIMARY KEY, one row at most, through the auto index SQLite names below. */
const REVIEW_READ_PLAN = ['SEARCH work_view_reviews USING INDEX sqlite_autoindex_work_view_reviews_1 (request_id=?)'];
const REVIEW_SIDECAR_ROWS = 5000;
/**
 * Requests the owner already has when the run starts (grouped, reviewed and sorted into Other, so the run has nothing to do for them), so that
 * every publish reads the review sidecar once per request. The window reports whole milliseconds (it rounds each side's time), so a run of a
 * handful of reads reads as 0 whether or not the time was added up; this many reads add up to a few ms.
 */
const LEDGER_REQUESTS = 200;
/** Most milliseconds all the run's main-thread SQL (the review point reads and the my-focus inserts) may add up to, on a synthetic sidecar of REVIEW_SIDECAR_ROWS rows. */
const TOTAL_SQL_BUDGET_MS = 25;
/** A budget the over-budget probe must exceed with a statement that really costs time, and a recursion deep enough to take far longer than it. */
const PROBE_BUDGET_MS = 5;
const COSTLY_STATEMENT = 'WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter WHERE n < 3000000) SELECT count(*) AS n FROM counter';

/** The one statement text of a production my-focus write, as recorded from SessionStore.appendWorkStateEntry (set in beforeEach). */
let focusWriteSql = '';
/** What recording ONE call of that method saw: the run's expected my-focus statements are derived from it, never typed. */
let focusWriteRecording: MainThreadStatements;
/** The store the run's my-focus writes go through: the production class on a synthetic in-memory database. */
let focusStore: SessionStore;
/** The database the run's routes read (the job thread's reader, the pre-opened probe): the real schema, the store above holds it open. */
let runDatabasePath: string;

/** The same one conversation as fixtureDatabase, in the real schema. Synthetic. */
function seedRunConversation(db: Database, at: number): void {
  const started = at - 3 * DAY;
  db.prepare("INSERT INTO sdk_sessions (id, platform_source, content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch) VALUES (1, 'claude', 'a', 'm1', 'repo/tree', 'Build the release cards', ?, ?)")
    .run(new Date(started).toISOString(), started);
  db.prepare("INSERT INTO user_prompts (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch) VALUES (1, 'a', 1, 'Build the release cards', ?, ?)")
    .run(new Date(started).toISOString(), started);
}

/** One call of the real SessionStore.appendWorkStateEntry under the witness, in a list of its own (the statement text does not depend on the list). */
function recordFocusWrite(store: SessionStore): MainThreadStatements {
  const witness = watchMainThreadStatements({ maxSqlMs: 1000 });
  let recording: MainThreadStatements;
  try { store.appendWorkStateEntry({ project: 'home', listName: 'witness-calibration', fields: { note: 'one call, recorded' } }); }
  finally { recording = witness.finish(); }
  return recording;
}

/** The recorded statement texts that are not one of the two known texts. Empty means the run made no other statement. */
const offList = (main: MainThreadStatements): string[] => main.seen.map(entry => entry.sql).filter(sql => sql !== focusWriteSql && sql !== REVIEW_READ_SQL);
/** The connection LocalReviewStore runs its reads on (private to the class: the test reaches in because the plan must be taken on THAT object). */
const reviewHandle = (store: unknown): Database => {
  const handle = (store as { db: Database | null }).db;
  if (!handle) throw new Error('LocalReviewStore has no open connection');
  return handle;
};

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
/** The database of the configured CloudSync the run's device id comes from (instrumented, so any SQL through it shows in the watch). */
let cloudSyncDatabase: Database | null;
const ledgerOfDefaultRefresh = join(DATA_DIR, 'work-view');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'refresh-job-'));
  databasePath = join(directory, 'source.db');
  now = Date.now();
  writeFixtureFile(databasePath, now);
  // The fixture-file writer of the job-thread tests and of the main-thread control below (not of the watched run, which writes through focusStore).
  writeDatabase = new Database(databasePath);
  writeDatabase.exec('PRAGMA busy_timeout = 1500');
  instrumentSlowQueries(writeDatabase);
  focusWriterOfFixture = focusWriter(writeDatabase, { firstEpoch: now });
  // The worker's my-focus write goes through SessionStore.appendWorkStateEntry; here, on a synthetic database opened (and so instrumented) before any watch.
  runDatabasePath = join(directory, 'run-source.db');
  focusStore = new SessionStore(runDatabasePath);
  seedRunConversation(focusStore.db, now);
  focusWriteRecording = recordFocusWrite(focusStore);
  focusWriteSql = focusWriteRecording.seen[0]?.sql ?? '';
  rmSync(ledgerOfDefaultRefresh, { recursive: true, force: true });
  routes = null;
  reviewSidecar = null;
  cloudSyncDatabase = null;
});

afterEach(async () => {
  await routes?.close();
  writeDatabase.close();
  focusStore.close();
  reviewSidecar?.close();
  cloudSyncDatabase?.close();
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

  /**
   * A CloudSync configured with synthetic credentials (no network: its fetch throws), on an instrumented database, with counters on the two
   * methods a device id could be read through. Built before the watch, so its own setup is not recorded.
   */
  function configuredCloudSync(): { cloudSync: CloudSync; calls: { localDeviceId: number; status: number } } {
    cloudSyncDatabase = instrumentSlowQueries(new Database(':memory:'));
    new SessionStore(cloudSyncDatabase);
    const cloudSync = new CloudSync(cloudSyncDatabase, {
      CLAUDE_MEM_CLOUD_SYNC_TOKEN: 'synthetic-token', CLAUDE_MEM_CLOUD_SYNC_USER_ID: 'synthetic-user',
      CLAUDE_MEM_CLOUD_SYNC_HUB_URL: 'https://hub.invalid', CLAUDE_MEM_CLOUD_SYNC_DEVICE_ID: SYNTHETIC_DEVICE_ID,
    }, { fetchImpl: (async () => { throw new Error('no network in this test'); }) as unknown as typeof fetch, settingsPath: join(directory, 'sync-settings.json') });
    const calls = { localDeviceId: 0, status: 0 };
    const localDeviceId = cloudSync.localDeviceId.bind(cloudSync);
    const status = cloudSync.status.bind(cloudSync);
    cloudSync.localDeviceId = () => { calls.localDeviceId++; return localDeviceId(); };
    cloudSync.status = () => { calls.status++; return status(); };
    return { cloudSync, calls };
  }

  /** The default automatic refresh, built by WorkViewRoutes' own constructor: it names no ledger and passes no autoRefresh. */
  function defaultRoutes(options: { readerCalls: string[]; agent: ReturnType<typeof fakeAgent>; clients: CountingClient[]; focusRows: unknown[]; cloudSync: CloudSync }): WorkViewRoutes {
    return new WorkViewRoutes({
      databasePath: runDatabasePath, reviewPath: join(directory, 'review.db'), setupStatePath: join(directory, 'setup-state.json'), settingsPath: join(directory, 'settings.json'),
      rulesFilePath: join(directory, 'MY-RULES.md'), claudeInstructionsPath: join(directory, 'CLAUDE.md'), homeProject: 'home', humanCopy: null, pollIntervalMs: 600_000,
      reader: spyOnRealReader(options.readerCalls),
      // Production's wiring (worker-service.ts): the routes take the CloudSync source and read the device id from it themselves.
      getCloudSync: () => options.cloudSync,
      // The my-focus write is the one database write that belongs to the main thread: production's own SessionStore method, as worker-service wires it.
      appendWorkStateEntry: entry => {
        options.focusRows.push(entry.fields);
        focusStore.appendWorkStateEntry(entry);
      },
      autoRefreshPlace: { pluginRoot: PLUGIN_ROOT, agentRunner: options.agent.dependencies, createJobClient: () => { const client = new CountingClient(); options.clients.push(client); return client; } },
    });
  }

  const autoRefreshOf = (live: WorkViewRoutes) => (live as unknown as { autoRefresh: AutoRefreshWorker | null }).autoRefresh;

  /**
   * A synthetic review sidecar of realistic size: rows written through a plain connection (not instrumented, so the seeding is not
   * recorded as main-thread work) into the table the routes' LocalReviewStore created.
   */
  function seedReviewSidecar(): Database {
    const sidecar = new Database(join(directory, 'review.db'));
    sidecar.exec('PRAGMA busy_timeout = 1500');
    const insert = sidecar.prepare("INSERT OR REPLACE INTO work_view_reviews (request_id, content_fingerprint, checked_at_epoch, actor) VALUES (?, ?, ?, 'local-user')");
    sidecar.transaction(() => { for (let index = 0; index < REVIEW_SIDECAR_ROWS; index++) insert.run(`synthetic-request-${index}`, `fingerprint-${index}`, now); })();
    return sidecar;
  }

  /** A ledger of LEDGER_REQUESTS grouped, reviewed requests, written where the default refresh keeps its ledger, each placed in Other by the owner. Synthetic. */
  function seedLedger(): void {
    const groups: Record<string, unknown> = {}, conversations: Record<string, string> = {};
    mkdirSync(join(ledgerOfDefaultRefresh, 'progress'), { recursive: true });
    for (let index = 0; index < LEDGER_REQUESTS; index++) {
      const anchor = key(`owned-${index}`), id = groupIdFor(anchor);
      groups[id] = { title: `Owned request ${index}`, anchor, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: { text: `Ask ${index}` } };
      conversations[anchor] = id;
      focusStore.appendWorkStateEntry({ project: 'home', listName: MY_FOCUS_LIST, fields: placementRowFields({ anchorConversationKey: anchor, focusAreaId: OTHER_FOCUS_AREA_ID, placedBy: 'owner' }) });
      writeFileSync(join(ledgerOfDefaultRefresh, 'progress', `${id}.json`), JSON.stringify({ groupId: id, state: 'in-progress', percent: 40, summary: 'Under way.', readings: [] }));
    }
    writeFileSync(join(ledgerOfDefaultRefresh, 'request-groups.json'), JSON.stringify({ version: 1, updatedAt: null, conversations, groups, ignored: {} }));
  }

  const countFocusRows = () => (focusStore.db.prepare('SELECT count(*) AS n FROM work_state_entries WHERE list_name = ?').get(MY_FOCUS_LIST) as { n: number }).n;

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
  async function runWatched(options: { agent?: ReturnType<typeof fakeAgent>; probe?: (live: WorkViewRoutes) => void } = {}) {
    const readerCalls: string[] = [];
    const clients: CountingClient[] = [];
    const focusRows: unknown[] = [];
    let probed = false;
    const agent = options.agent ?? fakeAgent((prompt, asked) => {
      if (options.probe && asked === 1 && !probed) { probed = true; options.probe(routes!); }
      return answerFor(prompt);
    });
    seedLedger();
    const focusRowsBefore = countFocusRows();
    const { cloudSync, calls: deviceIdCalls } = configuredCloudSync();
    routes = defaultRoutes({ readerCalls, agent, clients, focusRows, cloudSync });
    const refresh = autoRefreshOf(routes);
    // F6: the constructor built the default refresh. Without the needs handoff it would scan on this thread, on its own handle.
    expect(refresh).not.toBeNull();
    reviewSidecar = seedReviewSidecar();
    const viewer = connectViewer(routes);
    const witness = watchMainThreadStatements({ maxSqlMs: TOTAL_SQL_BUDGET_MS });
    let outcome: Awaited<ReturnType<AutoRefreshWorker['runNow']>>;
    let main: ReturnType<typeof witness.finish>;
    try {
      outcome = await refresh!.runNow({ reason: 'test' });
      // The focus write publishes without being awaited: let every publish the run caused finish before the watch ends.
      await Promise.all(viewer.publishes);
    } finally { main = witness.finish(); }
    return { outcome, main, readerCalls, clients, focusRows, focusRowsBefore, agent, refresh: refresh!, probed, viewer, deviceIdCalls };
  }

  it('runs every database read and write of the run on the job thread: the main thread runs the my-focus write and the one review read, and nothing else', async () => {
    const { outcome, main, readerCalls, clients, focusRows, focusRowsBefore, agent, refresh, viewer, deviceIdCalls } = await runWatched();

    // The device id comes from a configured CloudSync, as in production. EXECUTION: the run read it through the accessor (the path was entered),
    // and never through status(), whose COUNT(*) queries would also show in the multiset below.
    expect(deviceIdCalls.localDeviceId).toBeGreaterThan(0);
    expect(deviceIdCalls.status).toBe(0);

    // (0) The my-focus writer is production's: one call of SessionStore.appendWorkStateEntry was recorded as exactly one statement text, run
    // once (prepare, then run). A statement added to that method shows up as a second text or a higher count and fails here, before the run's
    // expectation (derived from this recording) could absorb it.
    expect(focusWriteRecording.seen).toEqual([{ sql: focusWriteSql, count: COUNTS_PER_STATEMENT }]);
    expect(focusWriteRecording.total).toBe(COUNTS_PER_STATEMENT);
    expect(focusWriteSql).not.toBe('');
    // (1) PROPOSITION: the recorded statements are, as a multiset, the two known texts and nothing else. Nothing is parsed: any other text
    // (a multi-statement exec included) is a different string and is listed here.
    expect(offList(main)).toEqual([]);
    expect(main.problem).toBeNull();
    // EXECUTION: the instrumentation was live for the run (it saw the my-focus write, as many times as rows were written) and the writer
    // really stored those rows (a stub that wrote nowhere would leave the store empty), and the viewer got a snapshot whose review reads ran on this thread.
    expect(focusRows.length).toBeGreaterThan(0);
    expect(countFocusRows() - focusRowsBefore).toBe(focusRows.length);
    expect(viewer.publishes.length).toBeGreaterThan(0);
    expect(viewer.stream.events).toContain('work-view');
    const reviewReads = main.total - focusWriteRecording.total * focusRows.length;
    expect(reviewReads).toBeGreaterThanOrEqual(2);
    expect(reviewReads % 2).toBe(0);
    expect([...main.seen].sort((a, b) => a.sql.localeCompare(b.sql))).toEqual([
      { sql: focusWriteSql, count: focusWriteRecording.total * focusRows.length },
      { sql: REVIEW_READ_SQL, count: reviewReads },
    ]);
    // (2) All of the run's SQL on this thread adds up to less than the budget, and to something: a dead accumulator reads 0.
    expect(main.sqlMs).toBeGreaterThan(0);
    expect(main.sqlMs).toBeLessThan(TOTAL_SQL_BUDGET_MS);

    // (3) The plan of the review read, taken on the connection object LocalReviewStore ran it on (after the watch, so the EXPLAIN is not recorded).
    const store = (routes as unknown as { reviews: { read(id: string, fingerprint: string): unknown } }).reviews;
    const handle = reviewHandle(store);
    // EXECUTION: a read through the store goes through that very object (a spy on its prepare sees the statement), so the plan is of the run's own connection.
    const prepared: string[] = [];
    const prepare = handle.prepare.bind(handle);
    handle.prepare = ((sql: string) => { prepared.push(sql); return prepare(sql); }) as typeof handle.prepare;
    store.read('synthetic-request-1', 'fingerprint-1');
    handle.prepare = prepare as typeof handle.prepare;
    expect(prepared).toEqual([REVIEW_READ_SQL]);
    expect(explainOn(handle, REVIEW_READ_SQL, ['synthetic-request-1', 'fingerprint-1'])).toEqual(REVIEW_READ_PLAN);

    // The run happened, through the reader's needs scan and a job thread, and its work landed.
    expect(outcome).toBe('ok');
    expect(readerCalls).toEqual(['refreshNeeds']);
    expect(clients.length).toBe(1);
    expect(agent.prompts.length).toBeGreaterThanOrEqual(4);
    // The run's one new request joined the owner's LEDGER_REQUESTS.
    const titles = Object.values(readLedger(ledgerOfDefaultRefresh).groups.groups).map((group: any) => group.title);
    expect(titles).toHaveLength(LEDGER_REQUESTS + 1);
    expect(titles).toContain('Release cards');
    expect(readLedger(ledgerOfDefaultRefresh).story.narrative).toBe('One request is under way.');
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
    const { outcome, main, readerCalls, clients } = await runWatched({ agent });
    // EXECUTION: the scan ran and found work to do (it went on to look for an agent, which there is none of).
    expect(outcome).toBe('waiting-for-agent');
    expect(readerCalls).toEqual(['refreshNeeds']);
    expect(main.total).toBe(0);
    expect(main.problem).toBeNull();
    expect(clients).toEqual([]);
  }, 20_000);

  describe('the witness fails on each way the main thread could run a statement the run does not make', () => {
    it('a connection opened BEFORE the watch and queried during the run (the shape the Database.prototype patch missed)', async () => {
      const preOpened = openSqliteDatabase(runDatabasePath, { readonly: true, create: false });
      try {
        let answered: unknown = null;
        const { main, outcome, probed } = await runWatched({ probe: () => { answered = preOpened.prepare('SELECT count(*) AS n FROM sdk_sessions').get(); } });
        // EXECUTION: the probe ran inside the run, read a row, and the run still finished.
        expect(probed).toBe(true);
        expect(answered).toEqual({ n: 1 });
        expect(outcome).toBe('ok');
        expect(offList(main)).toEqual(['SELECT count(*) AS n FROM sdk_sessions']);
      } finally { preOpened.close(); }
    }, 30_000);

    it('another statement on the connection LocalReviewStore reads through', async () => {
      let count: unknown = null;
      const { main, probed } = await runWatched({
        probe: live => { count = reviewHandle((live as unknown as { reviews: unknown }).reviews).prepare('SELECT count(*) AS n FROM work_view_reviews').get(); },
      });
      expect(probed).toBe(true);
      // EXECUTION: the probe read the synthetic sidecar's rows.
      expect(count).toEqual({ n: REVIEW_SIDECAR_ROWS });
      expect(offList(main)).toEqual(['SELECT count(*) AS n FROM work_view_reviews']);
    }, 30_000);

    it('a statement outside the two texts on the SAME connection as the my-focus write', async () => {
      const { main } = await runWatched({ probe: () => { focusStore.db.prepare('SELECT count(*) AS n FROM work_state_entries').get(); } });
      expect(offList(main)).toEqual(['SELECT count(*) AS n FROM work_state_entries']);
    }, 30_000);

    it('a multi-statement exec that begins with the my-focus insert', async () => {
      const MULTI = "INSERT INTO work_state_entries (project, list_name, fields, created_at, created_at_epoch) VALUES ('p', 'l', '{}', 't', 0); DELETE FROM work_state_entries WHERE id < 0";
      const { main, probed } = await runWatched({ probe: () => { focusStore.db.exec(MULTI); } });
      expect(probed).toBe(true);
      // The text is not either known text, so it is listed whole, with its second statement.
      expect(offList(main)).toEqual([MULTI]);
    }, 30_000);
  });

  describe('the helper itself', () => {
    const connection = () => {
      const database = instrumentSlowQueries(new Database(':memory:'));
      database.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, team INTEGER); CREATE INDEX people_name ON people (name)');
      return database;
    };

    it('fails when a statement that really costs time runs over a positive budget (and stays quiet for one inside it)', () => {
      const database = connection();
      const witness = watchMainThreadStatements({ maxSqlMs: PROBE_BUDGET_MS });
      const answered = database.prepare(COSTLY_STATEMENT).get();
      const main = witness.finish();
      // EXECUTION: the recursion ran to its end, the statement was recorded, and its time was added up: a dead accumulator reads 0 and passes the budget.
      expect(answered).toEqual({ n: 3_000_000 });
      expect(main.total).toBe(2);
      expect(main.sqlMs).toBeGreaterThan(PROBE_BUDGET_MS);
      expect(main.problem).toMatch(new RegExp(`took .* ms on this thread, over the ${PROBE_BUDGET_MS} ms budget`));
      // The same statement inside a budget it fits is no problem.
      const roomy = watchMainThreadStatements({ maxSqlMs: main.sqlMs * 100 });
      database.prepare(COSTLY_STATEMENT).get();
      expect(roomy.finish().problem).toBeNull();
      database.close();
    });

    it('fails when the report cannot name every statement (a fourth distinct text)', () => {
      const database = connection();
      const witness = watchMainThreadStatements({ maxSqlMs: 1000 });
      for (const column of ['id', 'name', 'team', 'rowid']) database.prepare(`SELECT ${column} FROM people`).all();
      const main = witness.finish();
      expect(main.total).toBe(8);
      expect(main.seen.length).toBe(3);
      expect(main.problem).toMatch(/2 more statements than the report itemises/);
      database.close();
    });

    it('refuses to start without a time budget: none, undefined or not a number', () => {
      for (const options of [undefined, {}, { maxSqlMs: undefined }, { maxSqlMs: Number.NaN }, { maxSqlMs: '5' }]) {
        expect(() => watchMainThreadStatements(options as never), JSON.stringify(options)).toThrow(/maxSqlMs/);
      }
    });

    it('refuses to report when its statement window was replaced during the watch', () => {
      const witness = watchMainThreadStatements({ maxSqlMs: TOTAL_SQL_BUDGET_MS });
      openStatementWindow(1000).close();
      expect(() => witness.finish()).toThrow(/canary/);
    });

    it('sees a plan change: the pinned plan stops matching after the index it used is dropped', () => {
      const database = connection();
      const BY_NAME = 'SELECT id FROM people WHERE name = ?';
      const pinned = explainOn(database, BY_NAME, ['n1']);
      expect(pinned).toEqual(['SEARCH people USING COVERING INDEX people_name (name=?)']);
      database.exec('DROP INDEX people_name');
      expect(explainOn(database, BY_NAME, ['n1'])).toEqual(['SCAN people']);
      database.close();
    });

    it('sees a review read that drifts from the pinned plan on the store\'s own connection (the primary-key column left out of the filter)', () => {
      const store = new LocalReviewStore(':memory:');
      try {
        const handle = reviewHandle(store);
        expect(explainOn(handle, REVIEW_READ_SQL, ['r', 'f'])).toEqual(REVIEW_READ_PLAN);
        const drifted = explainOn(handle, 'SELECT checked_at_epoch FROM work_view_reviews WHERE content_fingerprint = ?', ['f']);
        expect(drifted).toEqual(['SCAN work_view_reviews']);
        expect(drifted).not.toEqual(REVIEW_READ_PLAN);
      } finally { store.close(); }
    });

    it('records the statements of the connection it explains on, so an EXPLAIN taken inside a watch is itself listed', () => {
      const store = new LocalReviewStore(':memory:');
      try {
        const handle = reviewHandle(store);
        const witness = watchMainThreadStatements({ maxSqlMs: 1000 });
        store.read('r', 'f');
        explainOn(handle, REVIEW_READ_SQL, ['r', 'f']);
        const main = witness.finish();
        // EXECUTION: the store's handle is an instrumented connection: its read and the EXPLAIN taken on it were both recorded.
        expect(main.seen.map(entry => entry.sql).sort()).toEqual([`EXPLAIN QUERY PLAN ${REVIEW_READ_SQL}`, REVIEW_READ_SQL].sort());
      } finally { store.close(); }
    });
  });

  describe('(4) the tables the two statements touch have no trigger after migrations', () => {
    it('work_state_entries (SessionStore migrations) and work_view_reviews (LocalReviewStore) hold none, and the query does see triggers that exist', () => {
      const sessions = new SessionStore(':memory:');
      // The worker's own schema setup: the search layer adds the FTS triggers on observations and session_summaries.
      new SessionSearch(sessions.db);
      const reviews = new LocalReviewStore(':memory:');
      try {
        const reviewDatabase = reviewHandle(reviews);
        const tables = (database: Database) => (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name);
        // EXECUTION: the migrations ran (both tables exist), and the query finds the triggers the schema does have (the observations FTS ones).
        expect(tables(sessions.db)).toContain('work_state_entries');
        expect(tables(reviewDatabase)).toContain('work_view_reviews');
        expect(triggersOn(sessions.db, ['observations']).length).toBeGreaterThan(0);
        expect(triggersOn(sessions.db, ['work_state_entries'])).toEqual([]);
        expect(triggersOn(reviewDatabase, ['work_view_reviews'])).toEqual([]);
        // MUTATION: a trigger added to either table, main or temp, is found.
        sessions.db.exec('CREATE TRIGGER work_state_entries_after AFTER INSERT ON work_state_entries BEGIN SELECT 1; END');
        reviewDatabase.exec('CREATE TEMP TRIGGER reviews_temp AFTER INSERT ON work_view_reviews BEGIN SELECT 1; END');
        expect(triggersOn(sessions.db, ['work_state_entries'])).toEqual(['work_state_entries.work_state_entries_after']);
        expect(triggersOn(reviewDatabase, ['work_view_reviews'])).toEqual(['work_view_reviews.reviews_temp']);
      } finally { sessions.close(); reviews.close(); }
    });
  });

  it('the witness fails when the same run happens on the main thread', async () => {
    const witness = watchMainThreadStatements({ maxSqlMs: TOTAL_SQL_BUDGET_MS });
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
    expect(offList(main).some(sql => sql.startsWith('SELECT'))).toBe(true);
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
