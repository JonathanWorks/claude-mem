import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import express from 'express';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { WorkViewRoutes } from '../../src/services/worker/http/routes/WorkViewRoutes.js';
import { groupIdFor, readLedger } from '../../src/services/work-view/request-groups.mjs';
import { deadPort } from '../helpers/dead-port.js';

// The request-progress skill's bundled script changes the ledger through the running worker (POST /api/work-view/ledger), never
// by writing the files itself, unless it is run with --offline. These tests spawn the real bundle against the real WorkViewRoutes.

const BUNDLE = join(import.meta.dir, '..', '..', 'plugin', 'skills', 'request-progress', 'scripts', 'request-groups.mjs');
const DAY = 86400000, NOW = Date.now();
const key = (session: string) => JSON.stringify(['conversation', 'claude', session]);
const A = key('a'), C = key('c'), D = key('d');
const GROUP_A = groupIdFor(A), GROUP_C = groupIdFor(C);
const EVIDENCE = 'Judge jev (typesafe/jev-1.14): picked "Release cards" over 1 open request (p 0.70); the check "continues that request" scored 0.63.';
const JOIN_D = { groups: [{ title: 'Release cards', conversations: [A, D], links: [{ kind: 'shared-work-list', conversations: [A, D], evidence: 'both wrote to release-cards' }] }] };

let directory: string;
let dataDir: string;
let ledgerDir: string;
let databasePath: string;
let source: Database;
let routes: WorkViewRoutes | null = null;
let server: Server | null = null;
let origin = '';
let port = 0;
/** Every POST /api/work-view/ledger the server received. */
let ledgerPosts = 0;
/** Runs once, before the first ledger POST is handled. */
let beforeFirstPost: (() => Promise<void>) | null = null;

const groupsFile = () => join(ledgerDir, 'request-groups.json');
const storyFile = () => join(ledgerDir, 'story.json');
const bytes = (path: string) => readFileSync(path, 'utf8');
const write = (name: string, value: unknown) => { const path = join(directory, name); writeFileSync(path, JSON.stringify(value)); return path; };

function writeFixtures(): void {
  source = new Database(databasePath);
  source.exec('PRAGMA journal_mode=WAL');
  source.exec(`
    CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER);
    CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT, platform_source TEXT, content_session_id TEXT, memory_session_id TEXT,
      user_prompt TEXT, custom_title TEXT, status TEXT, started_at_epoch INTEGER, completed_at_epoch INTEGER);
    CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER);
    CREATE TABLE observations (id INTEGER PRIMARY KEY, project TEXT, memory_session_id TEXT, content_session_id TEXT, agent_id TEXT, agent_type TEXT,
      prompt_number INTEGER, title TEXT, subtitle TEXT, type TEXT, created_at_epoch INTEGER, narrative TEXT);
    CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, project TEXT, memory_session_id TEXT, prompt_number INTEGER, request TEXT, completed TEXT, next_steps TEXT, created_at_epoch INTEGER);
    CREATE TABLE tool_uses (id INTEGER PRIMARY KEY, project TEXT, platform_source TEXT, agent_id TEXT, agent_type TEXT, session_db_id INTEGER, memory_session_id TEXT,
      content_session_id TEXT, prompt_number INTEGER, tool_input TEXT, created_at_epoch INTEGER, tool_name TEXT);
  `);
  const session = source.prepare('INSERT INTO sdk_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const prompt = source.prepare('INSERT INTO user_prompts VALUES (?, ?, ?, ?, ?)');
  const asks: Array<[string, string, number]> = [['a', 'Build the release cards', 3], ['c', 'Fix the card spacing', 2], ['d', 'Write the release notes', 1]];
  asks.forEach(([id, text, daysAgo], index) => {
    session.run(index + 1, 'repo', 'claude', id, `m${index + 1}`, text, null, 'active', NOW - daysAgo * DAY, null);
    prompt.run(index + 1, index + 1, 1, text, NOW - daysAgo * DAY);
  });
  // a is an open request; c is its own request with the judge's mid-band pick waiting for the owner.
  writeFileSync(groupsFile(), JSON.stringify({
    version: 1, updatedAt: null,
    conversations: { [A]: GROUP_A, [C]: GROUP_C },
    groups: {
      [GROUP_A]: { title: 'Release cards', anchor: A, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: null },
      [GROUP_C]: { title: 'Fix the card spacing', anchor: C, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: null },
    },
    ignored: {},
    suggestions: { [C]: { requestId: GROUP_A, confidence: 0.63, evidence: EVIDENCE, judge: 'jev', at: new Date(NOW).toISOString(), status: 'open' } },
  }));
}

/** The worker's routes on a real port; `beforeFirstPost` runs ahead of the first ledger change reaching them. */
async function serve({ withLedgerRoute = true } = {}): Promise<void> {
  routes = new WorkViewRoutes({ getCloudSync: () => null, databasePath, reviewPath: join(directory, 'review.db'), pollIntervalMs: 20, humanCopy: null, ledgerDir, setupStatePath: join(directory, 'setup-state.json') });
  const app = express();
  app.use(express.json());
  app.post('/api/work-view/ledger', async (_req, _res, next) => {
    ledgerPosts++;
    const hook = beforeFirstPost;
    beforeFirstPost = null;
    if (hook) await hook();
    next();
  });
  if (withLedgerRoute) routes.setupRoutes(app);
  else app.use((_req, res) => { res.status(404).send('not found'); });
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  port = address.port;
  origin = `http://127.0.0.1:${port}`;
}

/**
 * The bundle, as an agent runs it. The worker host and port are always pinned (to the test server or a dead port), so the
 * computer's own worker is never reached; the data folder is this test's own.
 */
async function cli(args: string[], { workerPort = port, data = dataDir, extraEnv = {} }: { workerPort?: number; data?: string | null; extraEnv?: Record<string, string> } = {}) {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_MEM_DB: databasePath, CLAUDE_MEM_WORKER_HOST: '127.0.0.1', CLAUDE_MEM_WORKER_PORT: String(workerPort), OPENROUTER_API_KEY: '', ...extraEnv };
  // `data: null` leaves the data folder to settings.json (or the home folder's default), as an install that sets it only there does.
  if (data === null) delete env.CLAUDE_MEM_DATA_DIR; else env.CLAUDE_MEM_DATA_DIR = data;
  const child = Bun.spawn([process.execPath, BUNDLE, ...args], { stdout: 'pipe', stderr: 'pipe', env });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ledger-cli-via-worker-'));
  dataDir = join(directory, 'data');
  ledgerDir = join(dataDir, 'work-view');
  mkdirSync(ledgerDir, { recursive: true });
  databasePath = join(directory, 'source.db');
  ledgerPosts = 0;
  beforeFirstPost = null;
  writeFixtures();
});

afterEach(async () => {
  routes?.close();
  routes = null;
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = null;
  source.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('the request-progress script changes the ledger through the worker', () => {
  it('sends the ledger folder the worker resolves: data folder only in settings.json, or ~/data in the environment', async () => {
    await serve();
    // The worker serves <directory>/data/work-view. A home folder of its own keeps the computer's real ~/.claude-mem out of it.
    const home = join(directory, 'home');
    mkdirSync(join(home, '.claude-mem'), { recursive: true });
    writeFileSync(join(home, '.claude-mem', 'settings.json'), JSON.stringify({ CLAUDE_MEM_DATA_DIR: dataDir }));
    const fromSettings = await cli(['apply', write('decisions.json', JOIN_D)], { data: null, extraEnv: { HOME: home } });
    expect(fromSettings.stderr).toBe('');
    expect(fromSettings.exitCode).toBe(0);
    // EXECUTION: the change reached the worker and the file it wrote holds it (a 409 for another folder would have written nothing).
    expect(ledgerPosts).toBeGreaterThan(0);
    expect(readLedger(ledgerDir).groups.conversations[D]).toBe(GROUP_A);

    // `~/data` is this test's data folder under the home folder `directory`: the worker's expandHome, not a folder named "~".
    // Applying the same decisions again is safe; the worker refusing the folder (409) would exit 1.
    const before = ledgerPosts;
    const fromTilde = await cli(['apply', write('decisions.json', JOIN_D)], { data: '~/data', extraEnv: { HOME: directory } });
    expect(fromTilde.stderr).toBe('');
    expect(fromTilde.exitCode).toBe(0);
    expect(ledgerPosts).toBeGreaterThan(before);
  }, 30_000);

  it('opens the database and writes the ledger in the one folder resolveDataDir answers: settings.json only, ~/data, and ~//data', async () => {
    await serve();
    // The worker's database is <data folder>/claude-mem.db: a copy there, and CLAUDE_MEM_DB empty, so only resolveDataDir can find it.
    source.exec(`VACUUM INTO '${join(dataDir, 'claude-mem.db')}'`);
    const home = join(directory, 'home');
    mkdirSync(join(home, '.claude-mem'), { recursive: true });
    writeFileSync(join(home, '.claude-mem', 'settings.json'), JSON.stringify({ CLAUDE_MEM_DATA_DIR: dataDir }));
    const cases: Array<[string, { data: string | null; extraEnv: Record<string, string> }]> = [
      ['settings.json only', { data: null, extraEnv: { HOME: home, CLAUDE_MEM_DB: '' } }],
      ['~/data', { data: '~/data', extraEnv: { HOME: directory, CLAUDE_MEM_DB: '' } }],
      ['~//data', { data: '~//data', extraEnv: { HOME: directory, CLAUDE_MEM_DB: '' } }],
    ];
    for (const [name, options] of cases) {
      // The database: candidates reads it (a read, no worker needed) and lists the conversation the fixture holds.
      const read = await cli(['candidates', '--brief'], options);
      expect(read.stderr, name).toBe('');
      expect(read.exitCode, name).toBe(0);
      expect(JSON.parse(read.stdout).candidates.map((candidate: { conversationKey: string }) => candidate.conversationKey), name).toContain(A);
      // The ledger: the worker serves <data folder>/work-view and takes the folder the script sends (a 409 for any other would exit 1).
      const before = ledgerPosts;
      const written = await cli(['apply', write('decisions.json', JOIN_D)], options);
      expect(written.stderr, name).toBe('');
      expect(written.exitCode, name).toBe(0);
      expect(ledgerPosts, name).toBeGreaterThan(before);
    }
    // --offline writes the same folder directly, resolved by the same function.
    const dead = await deadPort();
    const offline = await cli(['record-story', '--offline', write('story.json', { narrative: 'Offline.' })], { workerPort: dead, data: '~//data', extraEnv: { HOME: directory, CLAUDE_MEM_DB: '' } });
    expect(offline.exitCode).toBe(0);
    expect(readLedger(ledgerDir).story).toMatchObject({ narrative: 'Offline.' });
  }, 30_000);

  it('keeps no data-folder default of its own: request-groups.mjs, its entry point and the bundle read it through resolveDataDir', () => {
    const sources = join(import.meta.dir, '..', '..', 'src', 'services', 'work-view');
    for (const file of ['request-groups.mjs', 'request-groups-cli.mjs', 'data-source.mjs']) {
      const text = readFileSync(join(sources, file), 'utf8');
      expect(text, file).not.toContain('CLAUDE_MEM_DATA_DIR');
      expect(text, file).not.toMatch(/['"]\.claude-mem['"]/);
    }
    const bundle = readFileSync(BUNDLE, 'utf8');
    // The env-only constant the bundle used to carry is gone, and the database path comes from resolveDbPath.
    expect(bundle).not.toContain('DATA_DIR2');
    expect(bundle).toContain('process.env.CLAUDE_MEM_DB || resolveDbPath()');
    expect(bundle).toMatch(/LEDGER_DIR = join\d*\(resolveDataDir\(\), "work-view"\)/);
  });

  it('an apply and the owner\'s Join that lands while it is in flight both survive', async () => {
    await serve();
    // The owner answers the suggestion after the script has read the ledger and sent its change, before the worker applies it.
    beforeFirstPost = async () => {
      const answered = await fetch(`${origin}/api/work-view/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ conversationKey: C, action: 'join' }) });
      expect(answered.status).toBe(200);
    };
    const result = await cli(['apply', write('decisions.json', JOIN_D)]);
    // EXECUTION: the script ran to the end, and its answer came from the worker.
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ groups: 1, conversations: 3 });
    const { groups } = readLedger(ledgerDir);
    // Both changes are in the file: c joined by the owner, d by the script, and c's own request is gone.
    expect(groups.conversations).toEqual({ [A]: GROUP_A, [C]: GROUP_A, [D]: GROUP_A });
    expect(Object.keys(groups.groups)).toEqual([GROUP_A]);
    expect(groups.suggestions[C].status).toBe('joined');
    // The owner's Join moved a conversation under the group after the script's facts were read: the worker asked for them and the script sent again.
    expect(ledgerPosts).toBe(2);
    expect(readdirSync(ledgerDir).filter(name => name.endsWith('.tmp'))).toEqual([]);
  }, 30_000);

  it('record-progress and record-story are written by the worker', async () => {
    await serve();
    const review = { groupId: GROUP_A, state: 'in-progress', percent: 40, summary: 'Cards are being built.', reviewBasis: { checkedThrough: new Date(NOW).toISOString(), conversations: [A] } };
    const progress = await cli(['record-progress', write('review.json', review)]);
    expect(progress.stderr).toBe('');
    expect(progress.exitCode).toBe(0);
    expect(JSON.parse(progress.stdout)).toMatchObject({ recorded: GROUP_A, percent: 40, readings: 1 });
    expect(readLedger(ledgerDir).progress[GROUP_A]).toMatchObject({ percent: 40 });

    const story = await cli(['record-story', write('story.json', { narrative: 'One request under way.' })]);
    expect(story.stderr).toBe('');
    expect(story.exitCode).toBe(0);
    expect(JSON.parse(story.stdout)).toEqual({ recorded: 'story', preferences: 0 });
    expect(readLedger(ledgerDir).story).toMatchObject({ narrative: 'One request under way.' });
    expect(ledgerPosts).toBe(2);
    expect(readdirSync(ledgerDir).filter(name => name.endsWith('.tmp'))).toEqual([]);
  }, 30_000);

  it('a change the worker refuses with a 400 is reported as a refusal and writes nothing', async () => {
    await serve();
    writeFileSync(storyFile(), JSON.stringify({ narrative: 'Old.', preferences: [] }));
    const before = bytes(storyFile());
    // The review names a request the ledger does not hold: only the worker, reading the file as it is, can tell.
    const result = await cli(['record-progress', write('review.json', { groupId: 'g_000000000000', state: 'in-progress', percent: 40, summary: 'x', reviewBasis: { checkedThrough: new Date(NOW).toISOString(), conversations: [A] } })]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('worker refused the progress change');
    expect(result.stderr).toContain('Unknown group');
    expect(bytes(storyFile())).toBe(before);
    expect(existsSync(join(ledgerDir, 'progress'))).toBe(false);
  }, 30_000);

  it('judge --apply sends each placement to the worker, and a code link joins', async () => {
    await serve();
    // d wrote to the work list a wrote to: a code link, so the rules judge joins it without Jev.
    const insert = source.prepare('INSERT INTO tool_uses (session_db_id, tool_name, tool_input, created_at_epoch) VALUES (?, ?, ?, ?)');
    insert.run(1, 'mcp__work_state_write', JSON.stringify({ list: 'release-cards', fields: { task: 'cards' } }), NOW - 3 * DAY);
    insert.run(3, 'mcp__work_state_write', JSON.stringify({ list: 'release-cards', fields: { task: 'notes' } }), NOW - DAY);
    const result = await cli(['judge', '--apply']);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(readLedger(ledgerDir).groups.conversations[D]).toBe(GROUP_A);
    expect(ledgerPosts).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe('the script never writes the ledger itself without --offline', () => {
  const untouched = () => ({ groups: bytes(groupsFile()), hasStory: existsSync(storyFile()), hasProgress: existsSync(join(ledgerDir, 'progress')) });
  const apply = () => ['apply', write('decisions.json', JOIN_D)];

  it('with no worker running it refuses, names the way out, and writes nothing', async () => {
    const before = untouched();
    const dead = await deadPort();
    for (const args of [apply(), ['record-story', write('story.json', { narrative: 'x' })], ['record-progress', write('review.json', { groupId: GROUP_A })]]) {
      const result = await cli(args, { workerPort: dead });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not reachable');
      expect(result.stderr).toContain('--offline');
      expect(result.stdout).toBe('');
    }
    expect(untouched()).toEqual(before);
  }, 30_000);

  it('a worker with no ledger route (an older worker) is refused the same way', async () => {
    await serve({ withLedgerRoute: false });
    const before = untouched();
    const result = await cli(apply());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('has no /api/work-view/ledger route');
    expect(untouched()).toEqual(before);
  }, 30_000);

  it('a worker that writes another ledger folder refuses with a 409, and neither folder is written', async () => {
    await serve();
    // The script's data folder is another one: its ledger is valid, and so is the worker's.
    const otherData = join(directory, 'other-data');
    const otherLedger = join(otherData, 'work-view');
    mkdirSync(otherLedger, { recursive: true });
    const otherGroups = readFileSync(groupsFile(), 'utf8');
    writeFileSync(join(otherLedger, 'request-groups.json'), otherGroups);
    const before = untouched();
    const result = await cli(apply(), { data: otherData });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('worker refused /api/work-view/ledger: 409');
    expect(result.stderr).toContain('Nothing was written.');
    expect(untouched()).toEqual(before);
    expect(readFileSync(join(otherLedger, 'request-groups.json'), 'utf8')).toBe(otherGroups);
  }, 30_000);
});

describe('--offline writes the files itself, for a computer with no worker', () => {
  it('apply works with the flag after or before the command, and warns that it is unsafe while a worker runs', async () => {
    const dead = await deadPort();
    const input = write('decisions.json', { groups: [{ title: 'Write the release notes', conversations: [D] }] });
    const after = await cli(['apply', input, '--offline'], { workerPort: dead });
    expect(after.exitCode).toBe(0);
    expect(after.stderr).toContain('--offline');
    expect(after.stderr).toContain('Unsafe while a worker runs');
    expect(JSON.parse(after.stdout)).toEqual({ groups: 3, conversations: 3 });
    expect(readLedger(ledgerDir).groups.conversations[D]).toBe(groupIdFor(D));

    const before = await cli(['--offline', 'apply', write('again.json', JOIN_D)], { workerPort: dead });
    expect(before.exitCode).toBe(0);
    expect(readLedger(ledgerDir).groups.conversations[D]).toBe(GROUP_A);
  }, 30_000);

  it('record-story writes story.json whole and leaves no temp file', async () => {
    const dead = await deadPort();
    const result = await cli(['record-story', '--offline', write('story.json', { narrative: 'One request under way.' })], { workerPort: dead });
    expect(result.exitCode).toBe(0);
    expect(readLedger(ledgerDir).story).toMatchObject({ narrative: 'One request under way.' });
    expect(readdirSync(ledgerDir).filter(name => name.endsWith('.tmp'))).toEqual([]);
  }, 30_000);
});
