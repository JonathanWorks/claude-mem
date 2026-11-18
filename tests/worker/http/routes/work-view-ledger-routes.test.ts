import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import express from 'express';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { WorkViewRoutes } from '../../../../src/services/worker/http/routes/WorkViewRoutes.js';
import { groupIdFor, readLedger } from '../../../../src/services/work-view/request-groups.mjs';

// POST /api/work-view/ledger: a skill script's change to the request ledger, applied through the worker's one writer
// (WorkViewRoutes.recordLedgerWrite -> applyLedgerWrite). These tests run the real routes over real HTTP.

const key = (session: string) => JSON.stringify(['conversation', 'claude', session]);
const A = key('a'), C = key('c');
const GROUP_A = groupIdFor(A);
const NOW = Date.now();
const FACTS = { projects: { [A]: 'repo', [C]: 'repo' }, anchorAsks: { [A]: { text: 'Build the release cards', atEpoch: NOW - 1000 } } };
const JOIN_C = { groups: [{ title: 'Release cards', conversations: [A, C], links: [{ kind: 'judge', conversations: [A, C], evidence: 'Same work.' }] }] };
const RULE = { preference: 'Carry it through release.', when: 'work is approved', kind: 'directive', supportCount: 2, quotes: [{ quote: 'never make me publish', at: '2026-10-21T09:00:00-07:00' }], source: 'owner-goals' };
const STORY_OWN = { preference: 'Keep the existing design.', kind: 'directive', supportCount: 1, quotes: [] };

let directory: string;
let source: Database;
let routes: WorkViewRoutes;
let server: Server;
let origin: string;
let ledgerDir: string;
/** Every work-state row the routes were asked to write: the ledger routes write none. */
let appended: unknown[];
const groupsFile = () => join(ledgerDir, 'request-groups.json');
const storyFile = () => join(ledgerDir, 'story.json');

function serve(options: { ledgerDir: string | null }): Promise<void> {
  routes = new WorkViewRoutes({ getCloudSync: () => null, databasePath: join(directory, 'source.db'), reviewPath: join(directory, 'review.db'), pollIntervalMs: 20, humanCopy: null, ledgerDir: options.ledgerDir, setupStatePath: join(directory, 'setup-state.json'),
    appendWorkStateEntry: (entry: unknown) => { appended.push(entry); } });
  const app = express();
  app.use(express.json());
  routes.setupRoutes(app);
  return new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test port');
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'work-view-ledger-routes-'));
  appended = [];
  source = new Database(join(directory, 'source.db'));
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
  ledgerDir = join(directory, 'work-view');
  mkdirSync(ledgerDir);
  // a is an open request; c is its own request.
  writeFileSync(groupsFile(), JSON.stringify({
    version: 1, updatedAt: null,
    conversations: { [A]: GROUP_A, [C]: groupIdFor(C) },
    groups: {
      [GROUP_A]: { title: 'Release cards', anchor: A, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: null },
      [groupIdFor(C)]: { title: 'Fix the card spacing', anchor: C, projectRoot: 'repo', links: [], decidedAt: null, anchorAsk: null },
    },
    ignored: {},
  }));
  await serve({ ledgerDir });
});

afterEach(async () => {
  routes.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  source.close();
  rmSync(directory, { recursive: true, force: true });
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${origin}/api/work-view/ledger`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
}
const send = (op: unknown, dir = ledgerDir) => post({ ledgerDir: dir, op });
const bytes = (path: string) => readFileSync(path, 'utf8');
const progressFor = (groupId: string, percent: number) => ({
  groupId, state: 'in-progress', percent, summary: 'Under way.', reviewBasis: { checkedThrough: new Date(NOW).toISOString(), conversations: [A] },
});

describe('POST /api/work-view/ledger', () => {
  it('apply with the facts it needs merges the decisions into the file as it is', async () => {
    const response = await send({ kind: 'apply', decisions: JOIN_C, now: NOW, facts: FACTS });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ done: { groups: 1, conversations: 2 } });
    const { groups } = readLedger(ledgerDir);
    expect(groups.conversations).toEqual({ [A]: GROUP_A, [C]: GROUP_A });
    expect(Object.keys(groups.groups)).toEqual([GROUP_A]);
  });

  it('apply without the facts answers needFacts and writes nothing', async () => {
    const before = bytes(groupsFile());
    const response = await send({ kind: 'apply', decisions: JOIN_C, now: NOW });
    expect(response.status).toBe(200);
    const reply = await response.json();
    expect(reply.needFacts.projects.sort()).toEqual([A, C].sort());
    expect(reply.done).toBeUndefined();
    expect(bytes(groupsFile())).toBe(before);
    expect(readdirSync(ledgerDir)).toEqual(['request-groups.json']);
  });

  it('progress records a review of a request in the ledger, and refuses one for an unknown request with a 400 that wrote nothing', async () => {
    // The script's writer sends `facts` with every change, empty for one that reads none.
    const written = await send({ kind: 'progress', answer: progressFor(GROUP_A, 40), now: NOW, facts: { projects: {}, anchorAsks: {} } });
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ done: { recorded: GROUP_A, state: 'in-progress', percent: 40, readings: 1 } });
    expect(readLedger(ledgerDir).progress[GROUP_A]).toMatchObject({ percent: 40 });

    const refused = await send({ kind: 'progress', answer: progressFor('g_000000000000', 40), now: NOW });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain('Unknown group');
    expect(readdirSync(join(ledgerDir, 'progress'))).toEqual([`${GROUP_A}.json`]);
  });

  it('story writes the validated story and keeps the rules owner-goals saved; a story that does not validate is a 400', async () => {
    writeFileSync(storyFile(), JSON.stringify({ narrative: 'Old.', preferences: [RULE] }));
    const written = await send({ kind: 'story', validated: { narrative: 'Under way.', preferences: [{ preference: 'Keep it short.', kind: 'directive', supportCount: 1, quotes: [] }] }, now: NOW });
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ done: { recorded: 'story', preferences: 2 } });
    expect(readLedger(ledgerDir).story).toMatchObject({ narrative: 'Under way.', preferences: [{ preference: 'Keep it short.' }, RULE] });

    const before = bytes(storyFile());
    // HTTP input is checked again: the CLI's own validation is not trusted.
    const refused = await send({ kind: 'story', validated: { narrative: 'x'.repeat(12001), preferences: [] }, now: NOW });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain('narrative is 12001 characters');
    expect(bytes(storyFile())).toBe(before);
  });

  it('place joins a conversation to its request through the judge placement', async () => {
    const D = key('d');
    const response = await send({
      kind: 'place', now: NOW, facts: { projects: { ...FACTS.projects, [D]: 'repo' }, anchorAsks: { ...FACTS.anchorAsks, [C]: { text: 'Fix the card spacing', atEpoch: NOW - 500 } } },
      placement: { key: D, root: 'repo', title: 'Check the release cards', verdict: { requestId: GROUP_A, band: 'join', confidence: 0.9, evidence: 'Same work.', judge: 'rules' }, picked: { groupId: GROUP_A, anchor: A, title: 'Release cards' } },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: { target: { groupId: GROUP_A, anchor: A, title: 'Release cards' }, suggested: null, title: 'Check the release cards' } });
    expect(readLedger(ledgerDir).groups.conversations[D]).toBe(GROUP_A);
  });

  describe('owner-goals-rules', () => {
    it('replaces only the rules owner-goals saved, keeping the narrative and the story\'s own preferences', async () => {
      writeFileSync(storyFile(), JSON.stringify({ narrative: 'The story.', writtenAt: '2026-10-20T00:00:00Z', preferences: [STORY_OWN, { ...RULE, preference: 'An old rule.' }] }));
      const response = await send({ kind: 'owner-goals-rules', preferences: [RULE] });
      expect(response.status).toBe(200);
      // The reply names the file the worker wrote.
      expect(await response.json()).toEqual({ done: { recorded: 'owner-goals-rules', preferences: 1, path: storyFile() } });
      expect(JSON.parse(bytes(storyFile()))).toEqual({ narrative: 'The story.', writtenAt: '2026-10-20T00:00:00Z', preferences: [STORY_OWN, RULE] });
    });

    it('creates story.json when there is none, and no rules clears the old ones', async () => {
      expect(existsSync(storyFile())).toBe(false);
      expect((await send({ kind: 'owner-goals-rules', preferences: [RULE] })).status).toBe(200);
      expect(JSON.parse(bytes(storyFile()))).toEqual({ preferences: [RULE] });
      expect((await send({ kind: 'owner-goals-rules', preferences: [] })).status).toBe(200);
      expect(JSON.parse(bytes(storyFile()))).toEqual({ preferences: [] });
    });

    it('refuses a rule of another source with a 400, so it can never delete the story\'s own preferences', async () => {
      writeFileSync(storyFile(), JSON.stringify({ narrative: 'The story.', preferences: [STORY_OWN, RULE] }));
      const before = bytes(storyFile());
      const response = await send({ kind: 'owner-goals-rules', preferences: [{ ...RULE, source: 'story' }] });
      expect(response.status).toBe(400);
      expect(bytes(storyFile())).toBe(before);
    });
  });

  it('refuses a ledger folder that is not this worker\'s with a 409, and writes into neither', async () => {
    const other = join(directory, 'other-ledger');
    mkdirSync(other);
    const before = bytes(groupsFile());
    const response = await send({ kind: 'owner-goals-rules', preferences: [RULE] }, other);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Nothing was written.');
    expect(readdirSync(other)).toEqual([]);
    expect(existsSync(storyFile())).toBe(false);
    expect(bytes(groupsFile())).toBe(before);
  });

  it('answers 503 on a worker with no ledger', async () => {
    routes.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await serve({ ledgerDir: null });
    const response = await send({ kind: 'owner-goals-rules', preferences: [] });
    expect(response.status).toBe(503);
    expect(existsSync(storyFile())).toBe(false);
  });

  it('refuses a foreign origin, a body that is not JSON and a proxied request with a 403, and an unknown kind with a 400', async () => {
    const op = { kind: 'owner-goals-rules', preferences: [RULE] };
    expect((await post({ ledgerDir, op }, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await post({ ledgerDir, op }, { 'Content-Type': 'text/plain' })).status).toBe(403);
    expect((await post({ ledgerDir, op }, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(403);
    expect(existsSync(storyFile())).toBe(false);
    expect((await send({ kind: 'delete-everything' })).status).toBe(400);
    expect((await post({ ledgerDir, op, extra: true })).status).toBe(400);
  });

  it('applies the change in the worker\'s queue: not while an earlier write is still running, then at once when it ends', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    // The owner's answer (or another write) in progress holds the queue; a script's change waits behind it.
    const holder = (routes as unknown as { serialized(task: () => Promise<void>): Promise<void> }).serialized(() => held);
    const before = bytes(groupsFile());
    const pending = send({ kind: 'apply', decisions: JOIN_C, now: NOW, facts: FACTS });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(bytes(groupsFile())).toBe(before);
    release();
    await holder;
    expect((await pending).status).toBe(200);
    expect(bytes(groupsFile())).not.toBe(before);
    expect(readLedger(ledgerDir).groups.conversations[C]).toBe(GROUP_A);
  });
});

// GET /api/work-view/ledger-dir: where the worker keeps its ledger. The owner-goals save (work-view-owner-goals-save.test.ts) uses the
// worker's own folder and takes no folder from the script. The real routes, over real HTTP.
describe('GET /api/work-view/ledger-dir', () => {
  it('answers the ledger folder and the database the worker was built with, and is for this computer only', async () => {
    const response = await fetch(`${origin}/api/work-view/ledger-dir`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ledgerDir, databasePath: join(directory, 'source.db') });
    expect((await fetch(`${origin}/api/work-view/ledger-dir`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status).toBe(403);
  });

  it('answers 503 on a worker with no ledger', async () => {
    routes.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await serve({ ledgerDir: null });
    expect((await fetch(`${origin}/api/work-view/ledger-dir`)).status).toBe(503);
  });
});
