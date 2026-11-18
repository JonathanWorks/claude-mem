import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import express from 'express';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { WorkViewRoutes } from '../../../../src/services/worker/http/routes/WorkViewRoutes.js';
import { AutoRefreshWorker } from '../../../../src/services/work-view/auto-refresh-worker.mjs';
import { inlineWorkViewReader, type WorkViewReader } from '../../../../src/services/work-view/work-view-reader.js';
import { emitContextInvalidation } from '../../../../src/shared/context-invalidation.js';

interface Spy { reader: WorkViewReader; calls: string[] }

let directory: string;
let databasePath: string;
let source: Database;
let server: Server | null;
let origin: string;
let routes: WorkViewRoutes | null;
let controllers: AbortController[];
let nextId: number;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function until(condition: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

function append(fields: Record<string, unknown>): void {
  source.prepare('INSERT INTO work_state_entries VALUES (?, ?, ?, ?, ?)').run(nextId++, 'example-project', 'example-work', JSON.stringify(fields), Date.now());
}

/** A reader that records each call and answers through the real inline reader, after an optional delay. */
function spyReader(delayMs = 0, log: string[] = []): Spy {
  const inner = inlineWorkViewReader();
  const slow = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    log.push(label);
    if (delayMs) await sleep(delayMs);
    return run();
  };
  return {
    calls: log,
    reader: {
      read: input => slow('read', () => inner.read(input)),
      rules: input => slow('rules', () => inner.rules(input)),
      refreshNeeds: input => slow('refreshNeeds', () => inner.refreshNeeds(input)),
      lastPrompts: input => slow('lastPrompts', () => inner.lastPrompts(input)),
      close: () => inner.close(),
    },
  };
}

/** Stands in for the summary pump and the automatic refresh: it only counts what the routes ask of it. */
class FakeWorker {
  starts = 0; stops = 0; closes = 0;
  async load(): Promise<void> {}
  start(): void { this.starts++; }
  stop(): void { this.stops++; }
  close(): void { this.closes++; }
  status(): null { return null; }
  pauseWhile(): void {}
  observe<T>(view: T): T { return view; }
}

async function listen(options: ConstructorParameters<typeof WorkViewRoutes>[0] = {}): Promise<WorkViewRoutes> {
  routes = new WorkViewRoutes({ getCloudSync: () => null,
    databasePath, reviewPath: join(directory, 'review.db'), pollIntervalMs: 20, ledgerDir: null,
    setupStatePath: join(directory, 'setup-state.json'), rulesFilePath: join(directory, 'MY-RULES.md'),
    claudeInstructionsPath: join(directory, 'CLAUDE.md'), homeProject: 'home', ...options,
  });
  const app = express();
  app.use(express.json());
  routes.setupRoutes(app);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  origin = `http://127.0.0.1:${address.port}`;
  return routes;
}

/** Opens the event stream and resolves once the first event arrived; the returned abort ends the stream. */
async function connect(): Promise<{ abort(): void; events: string[] }> {
  const controller = new AbortController();
  controllers.push(controller);
  const response = await fetch(`${origin}/api/work-view/events`, { signal: controller.signal });
  const events: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const match of decoder.decode(value).matchAll(/^event: (.+)$/gm)) events.push(match[1]);
      }
    } catch { /* the test aborted the stream */ }
  })();
  await until(() => events.includes('work-view'), 'the first work-view event');
  return { abort: () => controller.abort(), events };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'work-view-timers-'));
  databasePath = join(directory, 'source.db');
  source = new Database(databasePath);
  source.exec('PRAGMA journal_mode=WAL');
  source.exec('CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER)');
  nextId = 1; controllers = []; routes = null; server = null;
  append({ task: 'Build the local viewer', status: 'done', request_id: 'viewer-request', human_request: 'Build a local work viewer', request_complete: true });
});

afterEach(async () => {
  controllers.forEach(controller => controller.abort());
  await routes?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  source.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('work view timers run only while a viewer is connected', () => {
  it('starts neither the summary pump nor the refresh at construction, and reads nothing with no viewer', async () => {
    const humanCopy = new FakeWorker();
    const autoRefresh = new FakeWorker();
    const spy = spyReader();
    await listen({ humanCopy: humanCopy as never, autoRefresh: autoRefresh as never, reader: spy.reader });
    await sleep(120);
    expect(humanCopy.starts).toBe(0);
    expect(autoRefresh.starts).toBe(0);
    expect(spy.calls).toEqual([]);
  });

  it('a setup scan update with no viewer publishes nothing and reads nothing', async () => {
    let notify: (state: { phase: string }) => void = () => {};
    const setupScan = {
      subscribe: (listener: (state: { phase: string }) => void) => { notify = listener; return () => {}; },
      state: () => ({ phase: 'idle' }), setExtractor() {},
    };
    const spy = spyReader();
    await listen({ humanCopy: null, autoRefresh: null, reader: spy.reader, setupScan: setupScan as never });
    notify({ phase: 'scanning' });
    await sleep(60);
    expect(spy.calls).toEqual([]);
  });

  it('starts the poll, the pump and the refresh on the first stream and stops all three when the last one ends', async () => {
    const humanCopy = new FakeWorker();
    const autoRefresh = new FakeWorker();
    const spy = spyReader();
    const live = await listen({ humanCopy: humanCopy as never, autoRefresh: autoRefresh as never, reader: spy.reader });
    const first = await connect();
    const second = await connect();
    await until(() => humanCopy.starts === 1 && autoRefresh.starts === 1, 'the workers to start');
    await until(() => spy.calls.length >= 4, 'the poll to read');
    first.abort();
    await until(() => live.getClientCount() === 1, 'the first stream to close');
    expect(humanCopy.stops).toBe(0);
    expect(autoRefresh.stops).toBe(0);
    second.abort();
    await until(() => live.getClientCount() === 0, 'the last stream to close');
    expect(humanCopy.stops).toBe(1);
    expect(autoRefresh.stops).toBe(1);
    const reads = spy.calls.length;
    await sleep(150);
    expect(spy.calls.length).toBe(reads);
  });

  it('a stream that reconnects within the check interval does not rerun the needs scan', async () => {
    let scans = 0;
    const autoRefresh = new AutoRefreshWorker({
      dir: directory, openDatabase: () => { throw new Error('the needs scan must go through readNeeds'); },
      runJob: async () => ({ state: 'ok', agent: null, result: null, error: null }), localDeviceId: () => '',
      readNeeds: async () => { scans++; return { due: 0, ungrouped: 0, goalsStale: false, unplaced: 0, otherChanged: false, needed: false }; },
    });
    const live = await listen({ humanCopy: null, autoRefresh });
    for (let round = 0; round < 3; round++) {
      const stream = await connect();
      await sleep(60);
      stream.abort();
      await until(() => live.getClientCount() === 0, 'the stream to close');
    }
    expect(scans).toBe(1);
  });

  it('the heartbeat reports the last source and reads nothing', async () => {
    const spy = spyReader();
    await listen({ humanCopy: null, autoRefresh: null, reader: spy.reader, pollIntervalMs: 600_000 });
    const stream = await connect();
    const before = spy.calls.length;
    (routes as unknown as { sendHeartbeat(): void }).sendHeartbeat();
    await until(() => stream.events.includes('heartbeat'), 'the heartbeat');
    expect(spy.calls.length).toBe(before);
  });

  it('a poll tick that finds the previous read still running reads nothing', async () => {
    const inner = inlineWorkViewReader();
    let reads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reader: WorkViewReader = {
      ...inner,
      read: async input => {
        reads++;
        if (reads > 1) await gate;
        return inner.read(input);
      },
    };
    await listen({ humanCopy: null, autoRefresh: null, reader });
    await connect();
    await sleep(250);
    expect(reads).toBe(2);
    release();
  });
});

describe('a sync that lands with nobody watching', () => {
  it('rewrites MY-RULES.md from a rules-only read, never the full scan', async () => {
    append({ task: 'Rule: own_one', rule_id: 'own_one', scope_tier: 'everywhere', scope_name: 'Everywhere', when: '', then: 'Keep answers short.',
      set_by: 'owner', status: 'on', source: 'you', times_seen: 1, quotes: '' });
    source.prepare('UPDATE work_state_entries SET list_name = ? WHERE id = ?').run('my-rules', nextId - 1);
    const spy = spyReader();
    await listen({ humanCopy: null, autoRefresh: null, reader: spy.reader });
    emitContextInvalidation('all', 'SyncApply.applyOps');
    await until(() => existsSync(join(directory, 'MY-RULES.md')), 'MY-RULES.md');
    expect(readFileSync(join(directory, 'MY-RULES.md'), 'utf8')).toContain('Keep answers short.');
    expect(spy.calls).toEqual(['rules']);
  });

  it('does not write an empty MY-RULES.md when the database cannot be read', async () => {
    const spy = spyReader();
    await listen({ databasePath: join(directory, 'missing.db'), humanCopy: null, autoRefresh: null, reader: spy.reader });
    emitContextInvalidation('all', 'SyncApply.applyOps');
    await until(() => spy.calls.length > 0, 'the rules read');
    await sleep(50);
    expect(existsSync(join(directory, 'MY-RULES.md'))).toBe(false);
  });
});

describe('the setup work list reads prompt times through the reader', () => {
  it('asks the reader for the conversations of the ledger\'s requests, and never opens the database on this thread', async () => {
    const ledgerDir = join(directory, 'ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const anchor = JSON.stringify(['conversation', 'claude', 'session-a']);
    writeFileSync(join(ledgerDir, 'request-groups.json'), JSON.stringify({
      version: 1, updatedAt: '2026-11-01T00:00:00.000Z', conversations: { [anchor]: 'group-a' }, ignored: {}, suggestions: {},
      groups: { 'group-a': { title: 'Release cards', anchor, anchorAsk: { atEpoch: 1000 }, links: [] } },
    }));
    const asked: Array<{ databasePath: string; conversations: Array<[string, string]> }> = [];
    const inner = inlineWorkViewReader();
    const reader: WorkViewReader = { ...inner, lastPrompts: async input => { asked.push(input); return input.conversations.map(() => 5000); } };
    await listen({ humanCopy: null, autoRefresh: null, reader, ledgerDir });
    const view = await (await fetch(`${origin}/api/work-view`)).json();
    expect(asked).toEqual([{ databasePath, conversations: [['claude', 'session-a']] }]);
    expect(view.setup.work).toEqual([{ groupId: 'group-a', title: 'Release cards', platform: 'claude', lastActiveAt: new Date(5000).toISOString(), progressPercent: null }]);
  });

  it('answers the list without prompt times, and asks again on the next view, when the reader fails', async () => {
    const ledgerDir = join(directory, 'ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const anchor = JSON.stringify(['conversation', 'claude', 'session-a']);
    writeFileSync(join(ledgerDir, 'request-groups.json'), JSON.stringify({
      version: 1, updatedAt: '2026-11-01T00:00:00.000Z', conversations: { [anchor]: 'group-a' }, ignored: {}, suggestions: {},
      groups: { 'group-a': { title: 'Release cards', anchor, anchorAsk: { atEpoch: 1000 }, links: [] } },
    }));
    let asks = 0;
    const inner = inlineWorkViewReader();
    const reader: WorkViewReader = { ...inner, lastPrompts: async input => { asks++; if (asks === 1) throw new Error('Context reader exited with code 1'); return input.conversations.map(() => 5000); } };
    await listen({ humanCopy: null, autoRefresh: null, reader, ledgerDir });
    const first = await (await fetch(`${origin}/api/work-view`)).json();
    expect(first.setup.work[0].lastActiveAt).toBe(new Date(1000).toISOString());
    const second = await (await fetch(`${origin}/api/work-view`)).json();
    expect(second.setup.work[0].lastActiveAt).toBe(new Date(5000).toISOString());
    expect(asks).toBe(2);
  });
});

describe('the reader', () => {
  it('answers an unreadable database, not an error, when its thread fails', async () => {
    const reader: WorkViewReader = {
      read: async () => { throw new Error('Context reader exited with code 1'); },
      rules: async () => ({ connected: false, rules: [] }), refreshNeeds: async () => { throw new Error('unused'); },
      lastPrompts: async () => { throw new Error('unused'); }, close: async () => {},
    };
    await listen({ humanCopy: null, autoRefresh: null, reader });
    const view = await (await fetch(`${origin}/api/work-view`)).json();
    expect(view.source).toMatchObject({ connected: false, error: 'Local work-state database could not be read. Retrying.' });
  });

  it('keeps the last view it built, marked disconnected and stale, when a later read fails', async () => {
    const inner = inlineWorkViewReader();
    let reads = 0;
    let failing = false;
    const reader: WorkViewReader = {
      ...inner,
      read: async input => {
        reads++;
        if (failing) throw new Error('Context reader queue is full');
        return inner.read(input);
      },
    };
    await listen({ humanCopy: null, autoRefresh: null, reader });
    const good = await (await fetch(`${origin}/api/work-view`)).json();
    expect(good.source.connected).toBe(true);
    expect(good.humanRequests).toHaveLength(1);
    failing = true;
    const kept = await (await fetch(`${origin}/api/work-view`)).json();
    expect(reads).toBe(2);
    expect(kept.source).toMatchObject({ connected: false, stale: true, error: 'Local work-state database could not be read. Retrying.' });
    expect(kept.humanRequests.map((request: { id: string }) => request.id)).toEqual(good.humanRequests.map((request: { id: string }) => request.id));
    expect(kept.humanRequests[0].original.text).toContain('Build a local work viewer');
    failing = false;
    const recovered = await (await fetch(`${origin}/api/work-view`)).json();
    expect(recovered.source.connected).toBe(true);
    expect(recovered.source.stale).not.toBe(true);
  });

  it('close() rejects a read in flight, and the request answers an error instead of hanging', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const inner = inlineWorkViewReader();
    let closed = false;
    const reader: WorkViewReader = {
      ...inner,
      read: async input => {
        await gate;
        if (closed) throw new Error('Context reader closed');
        return inner.read(input);
      },
      close: async () => { closed = true; await inner.close(); },
    };
    const live = await listen({ humanCopy: null, autoRefresh: null, reader });
    const pending = fetch(`${origin}/api/work-view`);
    await sleep(30);
    const closing = live.close();
    release();
    await closing;
    expect((await pending).status).toBe(500);
  });

  it('serializes mutating handlers: the second reads after the first has written', async () => {
    const log: string[] = [];
    const spy = spyReader(40, log);
    await listen({
      humanCopy: null, autoRefresh: null, reader: spy.reader,
      appendWorkStateEntry: ({ project, listName, fields }) => {
        log.push('write');
        source.prepare('INSERT INTO work_state_entries VALUES (?, ?, ?, ?, ?)').run(nextId++, project, listName, JSON.stringify(fields), Date.now());
      },
    });
    const add = (then: string) => fetch(`${origin}/api/work-view/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ action: 'add', rule: { scopeTier: 'everywhere', scopeName: '', when: '', then } }),
    });
    const [first, second] = await Promise.all([add('First rule.'), add('Second rule.')]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(log.slice(0, 2)).toEqual(['read', 'write']);
    expect(log.indexOf('write', 2) - log.indexOf('write')).toBeGreaterThan(2);
    const rules = (await (await fetch(`${origin}/api/work-view`)).json()).rules.map((rule: { then: string }) => rule.then);
    expect(rules).toEqual(expect.arrayContaining(['First rule.', 'Second rule.']));
  });
});

describe('on its own thread', () => {
  it('serves the view, reads its own write back, and close() ends the thread', async () => {
    await listen({
      humanCopy: null, autoRefresh: null, execution: 'worker',
      appendWorkStateEntry: ({ project, listName, fields }) => {
        source.prepare('INSERT INTO work_state_entries VALUES (?, ?, ?, ?, ?)').run(nextId++, project, listName, JSON.stringify(fields), Date.now());
      },
    });
    const view = await (await fetch(`${origin}/api/work-view`)).json();
    expect(view.source.connected).toBe(true);
    expect(view.humanRequests[0].original.text).toContain('Build a local work viewer');
    const saved = await fetch(`${origin}/api/work-view/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ action: 'add', rule: { scopeTier: 'everywhere', scopeName: '', when: '', then: 'Read it back.' } }),
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.rules.map((rule: { ruleId: string }) => rule.ruleId)).toContain(body.savedRuleId);
    await routes!.close();
  }, 20_000);
});
