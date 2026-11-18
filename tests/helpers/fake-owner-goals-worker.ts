/**
 * The worker save_goals.py talks to, over real HTTP: the REAL WorkViewRoutes (strict zod bodies, the owner-goals save with its plan,
 * its schemas and its idempotency key, the ledger folder rule, the serialized single writer) on a real port, in front of a real SQLite
 * database. Its store is a real transaction (`appendWorkStateEntriesAtomically` wraps `db.transaction`), so a fault injected in it
 * (`failAtRow`) is rolled back by SQLite, not by the test. A thin proxy sits in front of the routes only to log every request in
 * arrival order ("GET /api/work-view", ...), to keep the bodies POST /api/work-view/owner-goals/save received (`saveBodies`) and to
 * misbehave on demand: `noSaveRoute` answers 404 as an older worker does; `saveBehavior` 'hang' reads the body and never answers,
 * 'apply-then-hang' lets the routes apply the save and then never sends the answer (the case the content key exists for).
 * `rows` is every work-state row saved, in order; `state()` and `focusAreas()` replay them with the worker's own reducers;
 * `ownerDecides` writes an owner decision as POST /api/work-view/focus would. Run save_goals.py against it with `run()`.
 */
import { Database } from 'bun:sqlite';
import express from 'express';
import { mkdirSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { WorkViewRoutes } from '../../src/services/worker/http/routes/WorkViewRoutes.js';
import { reduceWorkState } from '../../src/services/work-view/data-source.mjs';
import { buildFocusAreas, focusAreaRowFields, MY_FOCUS_LIST, type FocusArea } from '../../src/services/work-view/my-focus.mjs';
import { resolvePythonCommand } from '../../src/services/work-view/python.js';

const SAVE_GOALS = join(import.meta.dir, '..', '..', 'plugin', 'skills', 'owner-goals', 'scripts', 'save_goals.py');
const python = await resolvePythonCommand();

export const SAVE_PATH = '/api/work-view/owner-goals/save';

const TABLES = `
  CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER);
  CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT, platform_source TEXT, content_session_id TEXT, memory_session_id TEXT,
    user_prompt TEXT, custom_title TEXT, status TEXT, started_at_epoch INTEGER, completed_at_epoch INTEGER);
  CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER);
  CREATE TABLE observations (id INTEGER PRIMARY KEY, project TEXT, memory_session_id TEXT, content_session_id TEXT, agent_id TEXT, agent_type TEXT,
    prompt_number INTEGER, title TEXT, subtitle TEXT, type TEXT, created_at_epoch INTEGER, narrative TEXT);
  CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, project TEXT, memory_session_id TEXT, prompt_number INTEGER, request TEXT, completed TEXT, next_steps TEXT, created_at_epoch INTEGER);
  CREATE TABLE tool_uses (id INTEGER PRIMARY KEY, project TEXT, platform_source TEXT, agent_id TEXT, agent_type TEXT, session_db_id INTEGER, memory_session_id TEXT,
    content_session_id TEXT, prompt_number INTEGER, tool_input TEXT, created_at_epoch INTEGER, tool_name TEXT);`;

interface FakeWorkerOptions {
  /** The ledger folder the worker serves (default <dataDir>/work-view). */
  ledgerDir?: string | null;
  /** Answer 404 for the save route, as a worker that predates it does. */
  noSaveRoute?: boolean;
  /** 'hang': read the save, never answer. 'apply-then-hang': the routes apply the save, then the answer is never sent. */
  saveBehavior?: 'hang' | 'apply-then-hang' | null;
  /** Throw from the store when an atomic save is about to insert its nth row (1-based): SQLite rolls the rows already inserted back. */
  failAtRow?: number | null;
  /** Throw from the store when every row is inserted, at the point the commit would follow. */
  failBeforeCommit?: boolean;
  /** With failBeforeCommit: a folder takes the place of story.json after it was written, so the worker cannot put the story back. */
  breakStoryOnFailure?: boolean;
}

export async function fakeOwnerGoalsWorker(dataDir: string, {
  ledgerDir = null, noSaveRoute = false, saveBehavior = null, failAtRow = null, failBeforeCommit = false, breakStoryOnFailure = false,
}: FakeWorkerOptions = {}) {
  mkdirSync(dataDir, { recursive: true });
  const servedLedger = ledgerDir ?? join(dataDir, 'work-view');
  mkdirSync(servedLedger, { recursive: true });
  const databasePath = join(dataDir, 'claude-mem.db');
  const database = new Database(databasePath);
  database.exec('PRAGMA journal_mode=WAL');
  database.exec(TABLES);
  let lastEpoch = 0;
  const insert = (entry: { project: string; listName: string; fields: Record<string, unknown> }) => {
    lastEpoch = Math.max(Date.now(), lastEpoch + 1);
    database.query('INSERT INTO work_state_entries (project, list_name, fields, created_at_epoch) VALUES (?, ?, ?, ?)')
      .run(entry.project, entry.listName, JSON.stringify(entry.fields), lastEpoch);
  };
  /** Every request the store was asked to save atomically, and how many of them reached their commit. */
  const atomicSaves = { entered: 0, rowsInserted: 0, committed: 0 };
  const routes = new WorkViewRoutes({
    getCloudSync: () => null, databasePath, reviewPath: join(dataDir, 'review.db'), pollIntervalMs: 20, humanCopy: null, ledgerDir: servedLedger,
    setupStatePath: join(dataDir, 'setup-state.json'), homeProject: 'home',
    appendWorkStateEntry: insert,
    appendWorkStateEntriesAtomically: (entries, beforeCommit) => {
      atomicSaves.entered++;
      database.transaction(() => {
        for (const [index, entry] of entries.entries()) {
          if (faultAtRow !== null && index + 1 === faultAtRow) throw new Error(`injected store fault before row ${index + 1}`);
          insert(entry);
          atomicSaves.rowsInserted++;
        }
        beforeCommit?.();
        if (failBeforeCommit) {
          if (breakStoryOnFailure) { rmSync(join(servedLedger, 'story.json'), { force: true }); mkdirSync(join(servedLedger, 'story.json')); }
          throw new Error('injected store fault before the commit');
        }
      })();
      atomicSaves.committed++;
    },
  });
  const app = express();
  app.use(express.json());
  routes.setupRoutes(app);
  let behavior = saveBehavior;
  let faultAtRow = failAtRow;
  const upstream = await new Promise<Server>((done) => { const listening = app.listen(0, '127.0.0.1', () => done(listening)); });
  const upstreamOrigin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;

  /** Every request received, "METHOD /path", in order. */
  const requests: string[] = [];
  /** The bodies POST /api/work-view/owner-goals/save received, in order. */
  const saveBodies: any[] = [];
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (path === SAVE_PATH) {
        const body = await request.text();
        saveBodies.push(JSON.parse(body));
        if (noSaveRoute) return new Response('not found', { status: 404 });
        if (behavior === 'hang') await new Promise(() => {});
        const answer = await fetch(`${upstreamOrigin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (behavior === 'apply-then-hang') await new Promise(() => {});
        return new Response(await answer.text(), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
      }
      const body = request.method === 'GET' ? undefined : await request.text();
      const answer = await fetch(`${upstreamOrigin}${path}`, { method: request.method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body });
      return new Response(await answer.text(), { status: answer.status, headers: { 'Content-Type': answer.headers.get('content-type') ?? 'text/plain' } });
    },
  });
  const rows = () => database.query('SELECT id, project, list_name, fields, created_at_epoch FROM work_state_entries ORDER BY id').all() as
    Array<{ id: number; project: string; list_name: string; fields: string; created_at_epoch: number }>;
  const state = () => reduceWorkState(rows());
  const focusAreas = (): FocusArea[] => buildFocusAreas(state()).focusAreas;
  return {
    /** Changes the row the store fails on from the next save on (null: it works). */
    setFailAtRow(next: number | null) { faultAtRow = next; },
    /** Changes how the save route misbehaves from the next request on (null: it answers). */
    setSaveBehavior(next: 'hang' | 'apply-then-hang' | null) { behavior = next; },
    rows, saveBodies, requests, state, focusAreas, atomicSaves, ledgerDir: servedLedger, origin: upstreamOrigin, databasePath,
    /** An owner decision, as POST /api/work-view/focus writes it. */
    ownerDecides(area: FocusArea, change: Partial<FocusArea>) { insert({ project: 'home', listName: MY_FOCUS_LIST, fields: focusAreaRowFields({ ...area, ...change, decidedBy: 'owner' }) }); },
    port: server.port,
    /**
     * `workerPort` points the script at another port (a dead one: no worker answers). `env` adds or replaces environment variables;
     * a null value removes one (CLAUDE_MEM_DATA_DIR is this worker's data folder unless it is removed or replaced).
     */
    async run(args: string[], { workerPort = server.port, env = {}, cwd }: { workerPort?: number; env?: Record<string, string | null>; cwd?: string } = {}) {
      const childEnv: Record<string, string | undefined> = { ...process.env, PYTHONUTF8: '1', CLAUDE_MEM_DATA_DIR: dataDir, CLAUDE_MEM_WORKER_HOST: '127.0.0.1', CLAUDE_MEM_WORKER_PORT: String(workerPort) };
      for (const [name, value] of Object.entries(env)) { if (value === null) delete childEnv[name]; else childEnv[name] = value; }
      const child = Bun.spawn([python.command, ...python.args, SAVE_GOALS, ...args], { env: childEnv, cwd, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    },
    /** Stops the proxy, the routes and the database. Awaited, so the next case never finds this one's port or files still in use. */
    async stop() {
      server.stop(true);
      routes.close();
      await new Promise<void>((done) => { upstream.close(() => done()); upstream.closeAllConnections?.(); });
      database.close();
    },
  };
}
