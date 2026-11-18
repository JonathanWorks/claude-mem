import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { runAgentTask, type AgentRunnerDependencies } from '../../src/services/agent-runner/run.js';
import { applyLedgerWrite, remoteLedgerWriter, type LedgerWriteOp } from '../../src/services/work-view/ledger-writes.mjs';
import { remoteRefreshTask } from '../../src/services/work-view/refresh-job-client.js';
import { factLookups, groupIdFor, LEDGER_FACTS_NEEDED_CODE, LEDGER_OFF_MAIN_THREAD_CODE, readLedger, runCli, writeJsonAtomic } from '../../src/services/work-view/request-groups.mjs';
import { decideSuggestion, routeUndecided } from '../../src/services/work-view/request-judge.mjs';
import { deadPort } from '../helpers/dead-port.js';
import { everyRequestInOther, focusWriter } from '../helpers/fake-focus-writer.js';
import { watchMainThreadStatements } from '../helpers/main-thread-sql-witness.js';

// The request ledger has one writer inside the worker, its main thread (ledger-writes.mjs). These tests run the owner's answers and
// the refresh job's changes through that one writer, in the orders that used to lose a write: the owner's Join / Not this, and the
// grouping agent's `apply`, landing while routing holds a copy of the ledger it read earlier.

const DAY = 86400000, NOW = Date.now();
const PLUGIN_ROOT = join(import.meta.dir, '..', '..', 'plugin');
const key = (session: string) => JSON.stringify(['conversation', 'claude', session]);
const A = groupIdFor(key('a')), B = groupIdFor(key('b')), C = groupIdFor(key('c')), D = groupIdFor(key('d'));
const NEEDS = { due: 0, ungrouped: 1, goalsStale: false, unplaced: 0, otherChanged: false, needed: true };
const SUGGESTION = { requestId: A, confidence: 0.6, evidence: 'Judge jev: scored 0.60', judge: 'jev', at: new Date(NOW).toISOString(), status: 'open' };

let dir: string;
let ledgerDir: string;
let databasePath: string;

/** a: an open request; b: its own request with an open suggestion to join a; c and d: new. a and c share a work list (a code link). */
function writeFixtures(): void {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, platform_source TEXT, content_session_id TEXT, memory_session_id TEXT, project TEXT, user_prompt TEXT, started_at_epoch INTEGER);
    CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER);
    CREATE TABLE tool_uses (id INTEGER PRIMARY KEY, session_db_id INTEGER, tool_name TEXT, tool_input TEXT, created_at_epoch INTEGER);
    CREATE TABLE observations (id INTEGER PRIMARY KEY, memory_session_id TEXT, type TEXT, title TEXT, subtitle TEXT, created_at_epoch INTEGER);
    CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER);`);
  const session = db.prepare('INSERT INTO sdk_sessions VALUES (?, ?, ?, ?, ?, ?, ?)');
  const prompt = db.prepare('INSERT INTO user_prompts (session_db_id, prompt_number, prompt_text, created_at_epoch) VALUES (?, ?, ?, ?)');
  const asks: Array<[string, string, number]> = [['a', 'Build the release cards', 5], ['b', 'Continue the release cards', 4], ['c', 'Check the release cards', 2], ['d', 'Write the pricing page', 1]];
  asks.forEach(([id, text, daysAgo], index) => {
    session.run(index + 1, 'claude', id, `m${index + 1}`, 'repo', text, NOW - daysAgo * DAY);
    prompt.run(index + 1, 1, text, NOW - daysAgo * DAY);
  });
  const write = db.prepare('INSERT INTO tool_uses (session_db_id, tool_name, tool_input, created_at_epoch) VALUES (?, ?, ?, ?)');
  write.run(1, 'mcp__work_state_write', JSON.stringify({ list: 'release-cards', fields: { task: 'cards' } }), NOW - 5 * DAY);
  write.run(3, 'mcp__work_state_write', JSON.stringify({ list: 'release-cards', fields: { task: 'qa' } }), NOW - 2 * DAY);
  writeFileSync(databasePath, db.serialize());
  db.close();
  const request = (anchor: string, title: string) => ({ title, anchor, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: null });
  writeFileSync(join(ledgerDir, 'request-groups.json'), JSON.stringify({
    version: 1, updatedAt: null, conversations: { [key('a')]: A, [key('b')]: B },
    groups: { [A]: request(key('a'), 'Release cards'), [B]: request(key('b'), 'Continue the cards') }, ignored: {},
    suggestions: { [key('b')]: SUGGESTION },
  }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-single-writer-'));
  ledgerDir = join(dir, 'ledger');
  mkdirSync(ledgerDir);
  databasePath = join(dir, 'source.db');
  writeFixtures();
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** The owner's answer, as the worker's main thread gives it: one synchronous read-modify-write on its own read-only handle. */
function ownerAnswers(action: 'join' | 'not-this') {
  const database = new Database(databasePath, { readonly: true });
  try { return decideSuggestion({ dir: ledgerDir, database: database as never, conversationKey: key('b'), action, now: NOW + 1000 }); }
  finally { database.close(); }
}

describe('the owner\'s answers and the refresh job\'s changes, through the one writer, on a real job thread', () => {
  /** An agent runner whose one logged-in agent answers each prompt of the run. */
  function fakeAgent() {
    const answerFor = (prompt: string): string => {
      if (prompt.includes('Do only section 1')) return JSON.stringify({ groups: [{ title: 'Write the pricing page', conversations: [key('d')] }], ignored: [] });
      if (prompt.includes('Do only section 2')) {
        const shows = JSON.parse(readFileSync(/is in (\S+\.json)/.exec(prompt)![1], 'utf8'));
        return JSON.stringify({ reviews: shows.map((show: any) => ({ groupId: show.groupId, state: 'in-progress', percent: 40, summary: 'Cards are being built.', reviewBasis: show.reviewBasis })) });
      }
      if (prompt.includes('Do only section 3')) return everyRequestInOther(prompt);
      if (prompt.includes('Do only section 4')) return JSON.stringify({ narrative: 'Two requests are under way.', preferences: [] });
      throw new Error(`Unexpected prompt: ${prompt.slice(-200)}`);
    };
    const dependencies: Partial<AgentRunnerDependencies> = {
      detect: async () => [{ id: 'claude-code', path: '/not/run/claude', authenticated: true, reason: 'fixture' }],
      buildEnv: async () => ({}),
      query: (({ prompt }: { prompt: string }) => (async function* () {
        yield { type: 'result', subtype: 'success', is_error: false, result: answerFor(prompt) };
      })()) as unknown as AgentRunnerDependencies['query'],
    };
    return dependencies;
  }

  /** One refresh run on a job thread. `onMain` runs on THIS thread just before each change the job sent is applied: the owner's answer landing then. */
  async function runJob(onMain: (op: LedgerWriteOp) => void) {
    const ops: LedgerWriteOp[] = [];
    // The worker's my-focus write, on the fixture database: the focus step needs its rows to be written.
    const focusDatabase = new Database(databasePath);
    focusDatabase.exec('PRAGMA busy_timeout = 1500');
    const focus = focusWriter(focusDatabase, { firstEpoch: NOW });
    const task = remoteRefreshTask({
      needs: NEEDS, reason: 'test', localDeviceId: '', saveFocus: body => focus.save(body),
      settings: { databasePath, dataDir: dir, ledgerDir, pluginRoot: PLUGIN_ROOT, settingsPath: join(dir, 'settings.json') },
      writeLedger: async op => { ops.push(op); onMain(op); return applyLedgerWrite(ledgerDir, op); },
    });
    try { return { run: await runAgentTask(task, fakeAgent()), ops }; } finally { await task.close(); focusDatabase.close(); }
  }

  it('the owner\'s Join, applied just before the job\'s routing placement reaches the main thread, is kept with the placement', async () => {
    let answer: unknown = null;
    const { run, ops } = await runJob(op => { if (op.kind === 'place' && !answer) answer = ownerAnswers('join'); });
    // EXECUTION: the job routed through a message (the rules judge joined c to a's request), and the owner's answer was applied in between.
    expect(run.error ?? run.state).toBe('ok');
    expect(answer).toEqual({ status: 'joined', requestId: A });
    const placement = ops.find(op => op.kind === 'place') as Extract<LedgerWriteOp, { kind: 'place' }>;
    expect(placement.placement).toMatchObject({ key: key('c'), picked: { groupId: A, anchor: key('a') }, verdict: { band: 'join', judge: 'rules' } });
    // Both survive: b joined a, c joined a, and the grouping agent's request for d.
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.suggestions[key('b')]).toMatchObject({ status: 'joined' });
    expect(ledger.conversations).toEqual({ [key('a')]: A, [key('b')]: A, [key('c')]: A, [key('d')]: D });
    expect(ledger.groups[B]).toBeUndefined();
  }, 30_000);

  it('the owner\'s Not this, applied just before the placement, is kept with it', async () => {
    let answer: unknown = null;
    const { run } = await runJob(op => { if (op.kind === 'place' && !answer) answer = ownerAnswers('not-this'); });
    expect(run.state).toBe('ok');
    expect(answer).toEqual({ status: 'declined', requestId: B });
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.suggestions[key('b')]).toMatchObject({ status: 'declined' });
    expect(ledger.conversations).toEqual({ [key('a')]: A, [key('b')]: B, [key('c')]: A, [key('d')]: D });
  }, 30_000);

  it('the owner\'s Join, applied just before the grouping agent\'s `apply`, is kept with it', async () => {
    let answer: unknown = null;
    const { run, ops } = await runJob(op => { if (op.kind === 'apply' && !answer) answer = ownerAnswers('join'); });
    expect(run.state).toBe('ok');
    expect(ops.some(op => op.kind === 'apply')).toBe(true);
    expect(answer).toEqual({ status: 'joined', requestId: A });
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.conversations).toEqual({ [key('a')]: A, [key('b')]: A, [key('c')]: A, [key('d')]: D });
    expect(ledger.groups[D]).toMatchObject({ title: 'Write the pricing page' });
  }, 30_000);
});

describe('routing\'s copy of the ledger goes stale while the judge is asked', () => {
  /** The writer the job thread has, with the main thread simulated by applyLedgerWrite on this one; `beforeApply` runs just before each change lands. */
  function jobWriter(beforeApply: (op: LedgerWriteOp) => void = () => {}) {
    const sent: LedgerWriteOp[] = [];
    const writer = remoteLedgerWriter({ dir: ledgerDir, send: async op => { sent.push(op); beforeApply(op); return applyLedgerWrite(ledgerDir, op); } });
    return { writer, sent };
  }
  const ownRequest = (during: () => void) => ({
    name: 'jev',
    judge: async () => { during(); return { requestId: null, confidence: 1, evidence: 'Judge jev: a request of its own.' }; },
  });
  const route = async (writer: ReturnType<typeof jobWriter>['writer'], judge: ReturnType<typeof ownRequest>) => {
    const database = new Database(databasePath, { readonly: true });
    try { return await routeUndecided({ dir: ledgerDir, database: database as never, judge: judge as never, now: NOW, apply: true, ledger: writer }); }
    finally { database.close(); }
  };

  it('the owner\'s Join answered while the judge is awaited is not overwritten by the placement', async () => {
    const { writer, sent } = jobWriter();
    let answer: unknown = null;
    const plan = await route(writer, ownRequest(() => { answer = ownerAnswers('join'); }));
    // EXECUTION: the judge ran (for d: the rules judge places c by its work list, without it) and the owner answered inside it; routing then
    // placed d through the writer, from the copy of the ledger it read before the owner's answer.
    expect(answer).toEqual({ status: 'joined', requestId: A });
    expect(sent.filter(op => op.kind === 'place').map(op => (op as { placement: { key: string } }).placement.key)).toEqual([key('c'), key('d')]);
    expect(plan.routed.map(entry => entry.conversationKey)).toEqual([key('c'), key('d')]);
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.suggestions[key('b')]).toMatchObject({ status: 'joined' });
    expect(ledger.conversations[key('b')]).toBe(A);
    expect(ledger.groups[B]).toBeUndefined();
    expect(ledger.conversations[key('c')]).toBe(A);
    expect(ledger.conversations[key('d')]).toBe(D);
    expect(ledger.groups[D]).toMatchObject({ title: 'Write the pricing page' });
  });

  it('the owner\'s Not this answered while the judge is awaited is kept', async () => {
    const { writer } = jobWriter();
    let answer: unknown = null;
    await route(writer, ownRequest(() => { answer = ownerAnswers('not-this'); }));
    expect(answer).toEqual({ status: 'declined', requestId: B });
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.suggestions[key('b')]).toMatchObject({ status: 'declined' });
    expect(ledger.conversations[key('b')]).toBe(B);
    expect(ledger.conversations[key('d')]).toBe(D);
  });

  it('the owner\'s Join that lands between the job\'s read of the ledger and the main thread\'s write is kept, and the placement is sent again with the facts it now needs', async () => {
    let answered = false;
    const { writer, sent } = jobWriter(op => { if (op.kind === 'place' && !answered) { answered = true; ownerAnswers('join'); } });
    await route(writer, ownRequest(() => {}));
    expect(answered).toBe(true);
    // c's placement joins a's request, which the owner's Join just gave a second member (b): the main thread had no fact for b, said so
    // (needFacts), and the job sent the placement again with it. d's placement needed one send.
    expect(sent.filter(op => op.kind === 'place').map(op => (op as { placement: { key: string } }).placement.key)).toEqual([key('c'), key('c'), key('d')]);
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.suggestions[key('b')]).toMatchObject({ status: 'joined' });
    expect(ledger.conversations).toEqual({ [key('a')]: A, [key('b')]: A, [key('c')]: A, [key('d')]: D });
  });

  it('a grouping `apply` sent while the judge is awaited keeps routing\'s placement, and routing keeps the apply', async () => {
    const { writer } = jobWriter();
    const decisions = { groups: [{ title: 'Renamed by the agent', conversations: [key('b')] }], ignored: [] };
    let applied: unknown = null;
    await route(writer, ownRequest(() => {
      writeFileSync(join(dir, 'decisions.json'), JSON.stringify(decisions));
      // The CLI's own `apply`, through the job's writer: it answers with a promise, which nothing here awaits inside the judge, so it is awaited after.
      applied = runCli(['apply', join(dir, 'decisions.json')], { dir: ledgerDir, database: new Database(databasePath, { readonly: true }) as never, now: NOW, ledger: writer, print: value => value });
    }));
    expect(await applied).toEqual({ groups: expect.any(Number), conversations: expect.any(Number) });
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.groups[B].title).toBe('Renamed by the agent');
    expect(ledger.conversations[key('c')]).toBe(A);
    expect(ledger.conversations[key('d')]).toBe(D);
  });
});

describe('the facts a change merges with', () => {
  const decisions = { groups: [{ title: 'Release cards, renamed', conversations: [key('a')] }], ignored: [] };
  const applyOp = (facts: unknown): LedgerWriteOp => ({ kind: 'apply', decisions, now: NOW, facts: facts as never });

  it('are sent with the change: the first send is enough when the ledger did not change meanwhile', async () => {
    const sent: LedgerWriteOp[] = [];
    const writer = remoteLedgerWriter({ dir: ledgerDir, send: async op => { sent.push(op); return applyLedgerWrite(ledgerDir, op); } });
    const database = new Database(databasePath, { readonly: true });
    try { await writer.apply(decisions, { database: database as never, now: NOW }); } finally { database.close(); }
    expect(sent).toHaveLength(1);
    expect((sent[0] as { facts: { projects: Record<string, string | null> } }).facts.projects).toEqual({ [key('a')]: 'repo' });
  });

  it('are read again, once, when the owner\'s Join changed which conversations the merge touches after the job read the ledger', async () => {
    let joined = false;
    const sent: LedgerWriteOp[] = [];
    const writer = remoteLedgerWriter({
      dir: ledgerDir,
      send: async op => {
        sent.push(op);
        // b joins a's request between the job's prefetch and the merge, so the merge now also touches b, whose project the job never read.
        if (!joined) { joined = true; ownerAnswers('join'); }
        return applyLedgerWrite(ledgerDir, op);
      },
    });
    const database = new Database(databasePath, { readonly: true });
    try { await writer.apply(decisions, { database: database as never, now: NOW }); } finally { database.close(); }
    expect(sent).toHaveLength(2);
    expect(Object.keys((sent[0] as { facts: { projects: object } }).facts.projects)).toEqual([key('a')]);
    expect(Object.keys((sent[1] as { facts: { projects: object } }).facts.projects).sort()).toEqual([key('a'), key('b')].sort());
    const ledger = readLedger(ledgerDir).groups;
    expect(ledger.groups[A].title).toBe('Release cards, renamed');
    expect(ledger.conversations[key('b')]).toBe(A);
    expect(ledger.suggestions[key('b')].status).toBe('joined');
  });

  it('are asked for by the main thread, and nothing is written, when they are missing', () => {
    const before = readFileSync(join(ledgerDir, 'request-groups.json'), 'utf8');
    expect(applyLedgerWrite(ledgerDir, applyOp({ projects: {}, anchorAsks: {} }))).toEqual({ needFacts: { projects: [key('a')] } });
    expect(applyLedgerWrite(ledgerDir, applyOp(undefined))).toEqual({ needFacts: { projects: [key('a')] } });
    expect(readFileSync(join(ledgerDir, 'request-groups.json'), 'utf8')).toBe(before);
  });

  it('treat null as "looked up, not found" and a missing key as "not looked up"', () => {
    const lookups = factLookups({ projects: { [key('a')]: 'repo', [key('b')]: null }, anchorAsks: {} });
    expect([...lookups.projectsOf([key('a'), key('b')])]).toEqual([[key('a'), 'repo']]);
    expect(() => lookups.projectsOf([key('a'), key('c'), key('d')])).toThrow(expect.objectContaining({ code: LEDGER_FACTS_NEEDED_CODE, needed: { projects: [key('c'), key('d')] } }));
    expect([...lookups.anchorAsksOf([])]).toEqual([]);
  });

  it('are given up on, loudly and without a write, when the main thread keeps asking for more', async () => {
    let asks = 0;
    const writer = remoteLedgerWriter({ dir: ledgerDir, send: async () => { asks++; return { needFacts: { projects: [key('a')] } }; } });
    const database = new Database(databasePath, { readonly: true });
    try { await expect(writer.apply(decisions, { database: database as never, now: NOW })).rejects.toThrow(/Nothing was written/); } finally { database.close(); }
    expect(asks).toBe(8);
  });

  it('are not needed by a progress review or the story: the first send is the only one', async () => {
    const sent: LedgerWriteOp[] = [];
    const writer = remoteLedgerWriter({ dir: ledgerDir, send: async op => { sent.push(op); return applyLedgerWrite(ledgerDir, op); } });
    await writer.recordStory({ narrative: 'Under way.', preferences: [] }, { now: NOW });
    expect(sent.map(op => op.kind)).toEqual(['story']);
    expect(readLedger(ledgerDir).story).toMatchObject({ narrative: 'Under way.', writtenAt: new Date(NOW).toISOString() });
  });
});

describe('a ledger file is written by the main thread alone', () => {
  it('refuses a write from a worker thread, writes nothing, and the same write on the main thread lands', async () => {
    const target = join(ledgerDir, 'story.json');
    const worker = new Worker(new URL('../helpers/ledger-writer-worker.mjs', import.meta.url));
    const answered = await new Promise<{ attempted: boolean; code?: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage({ path: target }); });
    // Never terminate it: the thread loaded bun:sqlite (request-groups.mjs), and on bun 1.3.8 ending such a thread kills the process (exit 133).
    // Unref'd, the idle thread keeps nothing alive and ends with the process.
    worker.unref();
    // EXECUTION: the worker reached writeJsonAtomic and was refused with the named code; nothing, not even a temp file, was left.
    expect(answered).toEqual({ attempted: true, code: LEDGER_OFF_MAIN_THREAD_CODE });
    expect(readdirSync(ledgerDir)).toEqual(['request-groups.json']);
    writeJsonAtomic(target, { narrative: 'main thread' });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ narrative: 'main thread' });
  });

  it('writes through a temp name of its own, never a shared `.tmp`, and leaves none behind, also when the rename fails', () => {
    const target = join(ledgerDir, 'story.json');
    // Another writer's file at the name the write used to take: it must be left exactly as it is.
    writeFileSync(`${target}.tmp`, 'someone else\'s temp');
    writeJsonAtomic(target, { narrative: 'first' });
    expect(readFileSync(`${target}.tmp`, 'utf8')).toBe('someone else\'s temp');
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ narrative: 'first' });
    // The rename onto a folder fails: the temp file it wrote is removed, and the error is the caller's.
    const folder = join(ledgerDir, 'folder.json');
    mkdirSync(folder);
    expect(() => writeJsonAtomic(folder, { narrative: 'second' })).toThrow();
    expect(readdirSync(ledgerDir).filter(name => name.endsWith('.tmp') && name !== 'story.json.tmp')).toEqual([]);
  });
});

describe('the request-progress skill\'s bundled script, run --offline, is a writer of its own, with no lock', () => {
  const BUNDLE = join(import.meta.dir, '..', '..', 'plugin', 'skills', 'request-progress', 'scripts', 'request-groups.mjs');

  it('record-story writes story.json whole, keeps the rules owner-goals saved, and leaves no lock or temp file', async () => {
    const data = mkdtempSync(join(tmpdir(), 'ledger-bundle-'));
    try {
      const ledger = join(data, 'work-view');
      mkdirSync(ledger, { recursive: true });
      const ownerRule = { preference: 'Carry it through release.', kind: 'directive', supportCount: 1, quotes: [], source: 'owner-goals' };
      writeFileSync(join(ledger, 'story.json'), JSON.stringify({ narrative: 'Old.', preferences: [ownerRule] }));
      const input = join(data, 'story-answer.json');
      writeFileSync(input, JSON.stringify({ narrative: 'One request under way.' }));
      // --offline: no worker runs for this script, so it writes the files itself (without the flag it sends the change to the worker, and
      // refuses when none answers: ledger-cli-via-worker.test.ts). The worker address is pinned to a dead port, never the computer's worker.
      const env = { ...process.env, CLAUDE_MEM_DATA_DIR: data, CLAUDE_MEM_WORKER_HOST: '127.0.0.1', CLAUDE_MEM_WORKER_PORT: String(await deadPort()) };
      const child = Bun.spawn([process.execPath, BUNDLE, 'record-story', '--offline', input], { stdout: 'pipe', stderr: 'pipe', env });
      // EXECUTION: the script ran to the end and printed its answer.
      expect(await child.exited).toBe(0);
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual({ recorded: 'story', preferences: 1 });
      expect(readLedger(ledger).story).toMatchObject({ narrative: 'One request under way.', preferences: [ownerRule] });
      expect(readdirSync(ledger)).toEqual(['story.json']);
      // The bundle is built from the source: nothing of a file lock is left in it.
      expect(readFileSync(BUNDLE, 'utf8')).not.toMatch(/\.ledger\.lock|withLedgerLock/);
    } finally { rmSync(data, { recursive: true, force: true }); }
  }, 30_000);
});

describe('what the main thread pays for a ledger change', () => {
  /** A ledger of 3000 requests, each with a progress review: a larger ledger than the owner's real one. Synthetic. */
  function bigLedger(): void {
    const groups: Record<string, unknown> = {}, conversations: Record<string, string> = {};
    mkdirSync(join(ledgerDir, 'progress'));
    for (let index = 0; index < 3000; index++) {
      const anchor = key(`big-${index}`), id = groupIdFor(anchor);
      groups[id] = { title: `Request ${index}`, anchor, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: { text: `Ask ${index}` } };
      conversations[anchor] = id;
      writeFileSync(join(ledgerDir, 'progress', `${id}.json`), JSON.stringify({ groupId: id, state: 'in-progress', percent: 40, summary: 'x'.repeat(400), readings: [] }));
    }
    writeFileSync(join(ledgerDir, 'request-groups.json'), JSON.stringify({ version: 1, updatedAt: null, conversations, groups, ignored: {} }));
  }
  /** Most milliseconds one change may take on the main thread (measured on this ledger, 3 runs: place 9-11 ms, apply 7-9 ms, progress 2.5 ms, story 0.2 ms; the bar is far under a 2 s health probe). */
  const BUDGET_MS = 50;

  it('is one small-JSON read-modify-write: no SQL statement, well under a health probe, on a ledger of 3000 requests', () => {
    bigLedger();
    const anchor = key('big-7'), id = groupIdFor(anchor);
    const placement = {
      key: key('new-one'), root: 'repo', title: 'A new request', picked: null,
      verdict: { requestId: null, band: 'new' as const, confidence: 1, evidence: 'Judge rules: none', judge: 'rules' },
    };
    const ops: LedgerWriteOp[] = [
      { kind: 'place', placement, now: NOW, facts: { projects: { [key('new-one')]: 'repo' }, anchorAsks: { [key('new-one')]: { text: 'A new request' } } } },
      { kind: 'apply', decisions: { groups: [{ title: 'Renamed', conversations: [anchor] }], ignored: [] }, now: NOW, facts: { projects: { [anchor]: 'repo' }, anchorAsks: {} } },
      { kind: 'progress', now: NOW, answer: { groupId: id, state: 'in-progress', percent: 90, summary: 'Nearly done.', reviewBasis: { checkedThrough: new Date(NOW).toISOString(), conversations: [anchor] } } },
      { kind: 'story', now: NOW, validated: { narrative: 'Under way.', preferences: [] } },
    ];
    const witness = watchMainThreadStatements({ maxSqlMs: 0 });
    const timings = new Map<string, number>();
    const replies: unknown[] = [];
    for (const op of ops) {
      const startedAt = performance.now();
      replies.push(applyLedgerWrite(ledgerDir, op));
      timings.set(op.kind, performance.now() - startedAt);
    }
    const main = witness.finish();
    // EXECUTION: every change was applied (done), and the watch was live (its canary was seen), so zero statements means none ran.
    expect(replies.every(reply => 'done' in (reply as object))).toBe(true);
    expect(main.total).toBe(0);
    expect(main.seen).toEqual([]);
    expect(main.problem).toBeNull();
    for (const [kind, ms] of timings) expect({ kind, ms: ms < BUDGET_MS }).toEqual({ kind, ms: true });
    expect(readLedger(ledgerDir).progress[id]).toMatchObject({ state: 'in-progress', percent: 90 });
  });
});
