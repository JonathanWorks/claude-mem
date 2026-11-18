import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { AddressInfo } from 'net';
import express from 'express';

import {
  UNSCOPED_TURN_SCOPE,
  configureUnscopedSqlTurns,
  describeOpenScopes,
  openStatementWindow,
  recordSqlBusy,
  runWithSqlScope,
  sqlScopeMiddleware,
  startSqlScope,
  type SlowRequestContext,
} from '../../src/services/sqlite/sql-scope.js';
import { instrumentSlowQueries } from '../../src/services/sqlite/slow-query-log.js';
import { createMiddleware } from '../../src/services/worker/http/middleware.js';
import { logger } from '../../src/utils/logger.js';

/** Each timed statement reads the clock twice; its elapsed time is the next queued duration (default 0). */
function statementClock(durations: number[]): () => number {
  let reads = 0;
  let time = 0;
  return () => {
    if (reads++ % 2 === 1) time += durations.shift() ?? 0;
    return time;
  };
}

describe('SQL scopes', () => {
  let db: Database;
  let warnings: Array<{ message: string; context: SlowRequestContext }>;
  const warn = (message: string, context: SlowRequestContext): void => {
    warnings.push({ message, context });
  };

  function instrument(durations: number[]): void {
    instrumentSlowQueries(db, { thresholdMs: 100000, now: statementClock(durations), warn: () => {} });
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, body TEXT)');
    warnings = [];
    configureUnscopedSqlTurns({ thresholdMs: 1000, warn, schedule: () => {} });
  });

  afterEach(() => {
    configureUnscopedSqlTurns();
    db.close();
  });

  it('adds up many statements that are each far below the statement threshold', () => {
    instrument(Array(20).fill(60));
    runWithSqlScope('chroma:test', () => {
      for (let i = 0; i < 20; i++) db.run('SELECT id FROM items WHERE id = 1');
    }, { thresholdMs: 1000, warn });

    expect(warnings).toHaveLength(1);
    const { message, context } = warnings[0];
    expect(message).toContain('SLOW_REQUEST');
    expect(message).toContain('scope=chroma:test');
    expect(context.statements).toBe(20);
    expect(context.sqlMs).toBe(1200);
    expect(context.maxStatementMs).toBe(60);
    expect(context.top[0].sql).toBe('SELECT id FROM items WHERE id = 1');
    expect(context.top[0].count).toBe(20);
    expect(context.top[0].caller).toContain('sql-scope.test');
  });

  it('stays quiet at or below the threshold', () => {
    instrument(Array(10).fill(100));
    runWithSqlScope('quiet', () => {
      for (let i = 0; i < 10; i++) db.run('SELECT 1');
    }, { thresholdMs: 1000, warn });
    expect(warnings).toHaveLength(0);
  });

  it('keeps attributing statements across awaits', async () => {
    instrument([300, 300, 300, 300]);
    await runWithSqlScope('async', async () => {
      db.run('SELECT 1');
      await Promise.resolve();
      db.run('SELECT 2');
      await new Promise(resolve => setTimeout(resolve, 1));
      db.run('SELECT 3');
      db.run('SELECT 4');
    }, { thresholdMs: 1000, warn });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].context.statements).toBe(4);
  });

  it('counts a nested scope in the child and in every open ancestor, each logging once', async () => {
    instrument([600, 600]);
    await runWithSqlScope('parent', async () => {
      db.run('SELECT 1');
      await runWithSqlScope('child', async () => {
        await Promise.resolve();
        db.run('SELECT 2');
      }, { thresholdMs: 500, warn });
    }, { thresholdMs: 1000, warn });

    expect(warnings.map(w => [w.context.scope, w.context.statements])).toEqual([['child', 1], ['parent', 2]]);
  });

  it('sends statements recorded after the scope ended to the unscoped-turn bucket, never throwing', () => {
    const flushes: Array<() => void> = [];
    configureUnscopedSqlTurns({ thresholdMs: 1000, warn, schedule: flush => flushes.push(flush) });
    const scope = startSqlScope('late', { thresholdMs: 1000, warn });
    scope.run(() => recordSqlBusy('SELECT 1', 2000));
    expect(scope.end()?.statements).toBe(1);
    expect(scope.end()).toBeNull();
    expect(() => scope.run(() => recordSqlBusy('SELECT 2', 2000))).not.toThrow();

    expect(warnings).toHaveLength(1);
    expect(warnings[0].context.statements).toBe(1);
    expect(flushes).toHaveLength(1);
    flushes[0]();
    expect(warnings).toHaveLength(2);
    expect(warnings[1].context.scope).toBe(UNSCOPED_TURN_SCOPE);
    expect(warnings[1].context.statements).toBe(1);
    expect(warnings[1].context.sqlMs).toBe(2000);
  });

  it('keeps a detached loop visible after its request scope ended: 800 x 20 ms warns as unscoped-turn', async () => {
    configureUnscopedSqlTurns({ thresholdMs: 1000, warn });
    const scope = startSqlScope('request', { thresholdMs: 1000, warn });
    let detached = Promise.resolve();
    scope.run(() => {
      detached = (async () => {
        await Promise.resolve();
        for (let i = 0; i < 800; i++) recordSqlBusy('SELECT body FROM items WHERE id = ?', 20);
      })();
    });
    expect(scope.end()).toBeNull();
    await detached;
    await new Promise(resolve => setImmediate(resolve));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('scope=unscoped-turn');
    expect(warnings[0].context.statements).toBe(800);
    expect(warnings[0].context.sqlMs).toBe(16000);
    expect(warnings[0].context.top[0].sql).toBe('SELECT body FROM items WHERE id = ?');
  });

  it('still counts a statement in a nested scope whose parent has ended, as long as the child is open', () => {
    const parent = startSqlScope('parent', { thresholdMs: 1000, warn });
    let child: ReturnType<typeof startSqlScope> | undefined;
    parent.run(() => { child = startSqlScope('child', { thresholdMs: 500, warn }); });
    parent.end();
    child?.run(() => recordSqlBusy('SELECT 1', 800));
    expect(child?.end()?.statements).toBe(1);
    expect(warnings.map(w => w.context.scope)).toEqual(['child']);
  });

  it('accounts forty injected 50 ms statements as one unscoped-turn warning (proves bucket accounting, not stall detection)', async () => {
    configureUnscopedSqlTurns({ thresholdMs: 1000, warn });
    for (let i = 0; i < 40; i++) recordSqlBusy('SELECT * FROM observations WHERE project = ?', 50);
    expect(warnings).toHaveLength(0);
    await new Promise(resolve => setImmediate(resolve));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].context.scope).toBe(UNSCOPED_TURN_SCOPE);
    expect(warnings[0].context.sqlMs).toBe(2000);
    expect(warnings[0].context.top[0]).toMatchObject({ sql: 'SELECT * FROM observations WHERE project = ?', count: 40, ms: 2000 });
  });

  describe('caller resolution', () => {
    function loadMapCounter(): { loadMap: (path: string) => null; calls: string[] } {
      const calls: string[] = [];
      return { calls, loadMap: path => { calls.push(path); return null; } };
    }

    it('reads no source map for a scope that never warns, even with a heavy key', () => {
      const { loadMap, calls } = loadMapCounter();
      runWithSqlScope('quiet-heavy', () => {
        for (let i = 0; i < 9; i++) recordSqlBusy('SELECT heavy', 100);
      }, { thresholdMs: 1000, warn, loadMap });
      expect(warnings).toHaveLength(0);
      expect(calls).toEqual([]);
    });

    it('resolves callers through the map loader only when the warning is logged', () => {
      const { loadMap, calls } = loadMapCounter();
      runWithSqlScope('slow', () => {
        for (let i = 0; i < 12; i++) recordSqlBusy('SELECT heavy', 100);
      }, { thresholdMs: 1000, warn, loadMap });
      expect(warnings).toHaveLength(1);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].context.top[0].caller).toContain('sql-scope.test');
    });

    it('names the mapped source, not the bundle, for a call site taken in a minified bundle', () => {
      const bundle = '/x/plugin/scripts/worker-service.cjs';
      const payload = {
        version: 3,
        sources: ['../../src/services/sqlite/slow-query-log.ts', '../../src/services/sqlite/SessionStore.ts'],
        names: [],
        mappings: 'AAAA,UCAA',
      };
      const calls: string[] = [];
      const site = new Error('site');
      site.stack = [
        'Error: site',
        `    at Zq (${bundle}:1:1)`,
        `    at Ka (${bundle}:1:5)`,
        `    at Mb (${bundle}:1:11)`,
      ].join('\n');
      runWithSqlScope('mapped', () => {
        recordSqlBusy('SELECT heavy', 1500, site);
      }, { thresholdMs: 1000, warn, loadMap: path => { calls.push(path); return path === bundle ? payload : null; } });
      expect(warnings).toHaveLength(1);
      expect(calls).toEqual([bundle]);
      expect(warnings[0].context.top[0].caller).toContain('src/services/sqlite/SessionStore.ts');
      expect(warnings[0].context.top[0].caller).toContain('[worker-service.cjs:1:11]');
    });

    it('names a caller only for a key whose own time passed threshold/20', () => {
      const { loadMap, calls } = loadMapCounter();
      runWithSqlScope('two-keys', () => {
        recordSqlBusy('SELECT heavy', 1000);
        recordSqlBusy('SELECT small', 20);
        recordSqlBusy('SELECT small', 20);
      }, { thresholdMs: 1000, warn, loadMap });
      expect(warnings).toHaveLength(1);
      const byQuery = Object.fromEntries(warnings[0].context.top.map(entry => [entry.sql, entry.caller]));
      expect(byQuery['SELECT heavy']).toContain('sql-scope.test');
      expect(Object.keys(byQuery)).toContain('SELECT small');
      expect(byQuery['SELECT small']).toBeUndefined();
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('sums thousands of tiny statements and still names the caller once the key is hot', () => {
      const { loadMap, calls } = loadMapCounter();
      runWithSqlScope('tiny', () => {
        for (let i = 0; i < 20000; i++) recordSqlBusy('SELECT tiny', 0.01);
        recordSqlBusy('SELECT tiny', 1500);
      }, { thresholdMs: 1000, warn, loadMap });
      expect(warnings).toHaveLength(1);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].context.top[0].count).toBe(20001);
    });
  });

  it('ends the scope when the function throws or rejects', async () => {
    expect(() => runWithSqlScope('throws', () => {
      recordSqlBusy('SELECT 1', 5000);
      throw new Error('boom');
    }, { thresholdMs: 1000, warn })).toThrow('boom');
    await expect(runWithSqlScope('rejects', async () => {
      recordSqlBusy('SELECT 1', 5000);
      throw new Error('nope');
    }, { thresholdMs: 1000, warn })).rejects.toThrow('nope');
    expect(warnings.map(w => w.context.scope)).toEqual(['throws', 'rejects']);
  });

  it('caps distinct SQL texts and folds the overflow into (other)', () => {
    runWithSqlScope('many', () => {
      for (let i = 0; i < 200; i++) recordSqlBusy(`SELECT ${i} FROM items`, 20);
    }, { thresholdMs: 1000, warn });
    const { top, statements } = warnings[0].context;
    expect(statements).toBe(200);
    expect(top.map(entry => entry.sql)).toContain('(other)');
    expect(top[0].sql).toBe('(other)');
    expect(top[0].count).toBe(136);
  });

  it('accepts an explicit non-positive thresholdMs option, which only the environment path rejects', () => {
    const scope = startSqlScope('negative', { thresholdMs: -1, warn });
    scope.run(() => recordSqlBusy('SELECT 1', 0.5));
    expect(scope.end()?.thresholdMs).toBe(-1);
  });

  it('reports wall time from the injected clock', () => {
    let time = 0;
    const scope = startSqlScope('wall', { thresholdMs: 10, now: () => time, warn });
    scope.run(() => recordSqlBusy('SELECT 1', 50));
    time = 400;
    expect(scope.end()?.wallMs).toBe(400);
  });

  it('sums statements outside any scope into one unscoped-turn warning per turn', () => {
    const flushes: Array<() => void> = [];
    configureUnscopedSqlTurns({ thresholdMs: 1000, warn, schedule: flush => flushes.push(flush) });
    for (let i = 0; i < 30; i++) recordSqlBusy('SELECT 1', 50);
    expect(flushes).toHaveLength(1);
    flushes[0]();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].context.scope).toBe(UNSCOPED_TURN_SCOPE);
    expect(warnings[0].context.statements).toBe(30);

    recordSqlBusy('SELECT 1', 50);
    expect(flushes).toHaveLength(2);
    flushes[1]();
    expect(warnings).toHaveLength(1);
  });

  it('does not count a statement in the unscoped bucket when a scope is active', () => {
    const flushes: Array<() => void> = [];
    configureUnscopedSqlTurns({ thresholdMs: 10, warn, schedule: flush => flushes.push(flush) });
    runWithSqlScope('inside', () => recordSqlBusy('SELECT 1', 500), { thresholdMs: 1000, warn });
    expect(flushes).toHaveLength(0);
  });

  describe('express middleware', () => {
    it('keeps the scope through the body parser and names it by route pattern, not URL', async () => {
      const app = express();
      app.use(express.json());
      app.use(sqlScopeMiddleware({ thresholdMs: 100, warn }));
      app.post('/api/x/:id', async (req, res) => {
        await Promise.resolve();
        recordSqlBusy('SELECT body FROM items', 150);
        await new Promise(resolve => setTimeout(resolve, 1));
        recordSqlBusy('SELECT body FROM items', 150);
        res.json({ ok: true, echoed: req.body.q });
      });
      const server = app.listen(0, '127.0.0.1');
      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/api/x/secret-id-42?search=private+text`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q: 'hello' }),
        });
        expect(await response.json()).toEqual({ ok: true, echoed: 'hello' });
        await new Promise(resolve => setTimeout(resolve, 20));
      } finally {
        server.close();
      }
      expect(warnings).toHaveLength(1);
      expect(warnings[0].context.scope).toBe('POST /api/x/:id');
      expect(warnings[0].context.statements).toBe(2);
      expect(JSON.stringify(warnings[0])).not.toContain('secret-id-42');
      expect(JSON.stringify(warnings[0])).not.toContain('private');
    });
  });

  describe('createMiddleware adoption', () => {
    it('mounts the scope after the JSON parser: one SLOW_REQUEST named by route, no ids or query text', async () => {
      const previousThreshold = process.env.CLAUDE_MEM_SLOW_REQUEST_MS;
      process.env.CLAUDE_MEM_SLOW_REQUEST_MS = '100';
      const logged: Array<{ message: string; context: SlowRequestContext }> = [];
      const spy = spyOn(logger, 'warn').mockImplementation(((component: string, message: string, context?: unknown) => {
        if (component === 'DB' && message.startsWith('SLOW_REQUEST')) logged.push({ message, context: context as SlowRequestContext });
      }) as typeof logger.warn);
      const app = express();
      app.use(...createMiddleware());
      app.post('/api/observations/:id', async (req, res) => {
        await Promise.resolve();
        recordSqlBusy('SELECT body FROM items', 150);
        await new Promise(resolve => setTimeout(resolve, 1));
        recordSqlBusy('SELECT body FROM items', 150);
        res.json({ echoed: req.body.q });
      });
      const server = app.listen(0, '127.0.0.1');
      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/api/observations/secret-id-77?search=private+text`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q: 'hello' }),
        });
        expect(await response.json()).toEqual({ echoed: 'hello' });
        await new Promise(resolve => setTimeout(resolve, 20));
      } finally {
        server.close();
        spy.mockRestore();
        if (previousThreshold === undefined) delete process.env.CLAUDE_MEM_SLOW_REQUEST_MS;
        else process.env.CLAUDE_MEM_SLOW_REQUEST_MS = previousThreshold;
      }
      expect(logged).toHaveLength(1);
      expect(logged[0].context.scope).toBe('POST /api/observations/:id');
      expect(logged[0].context.statements).toBe(2);
      expect(JSON.stringify(logged[0])).not.toContain('secret-id-77');
      expect(JSON.stringify(logged[0])).not.toContain('private');
    });
  });
});

describe('statement window and open scopes', () => {
  afterEach(() => {
    configureUnscopedSqlTurns();
  });

  const quiet = { thresholdMs: 1_000_000, warn: () => {} };

  it('keeps the same SQL run under two scopes as two entries, each with its own scope', () => {
    const window = openStatementWindow(1000);
    runWithSqlScope('first', () => recordSqlBusy('SELECT shared', 30), quiet);
    runWithSqlScope('second', () => recordSqlBusy('SELECT shared', 20), quiet);
    runWithSqlScope('second', () => recordSqlBusy('SELECT shared', 10), quiet);
    const { scoped, unscoped } = window.drain();
    window.close();
    expect(unscoped).toBeNull();
    expect(scoped?.statements).toBe(3);
    expect(scoped?.top.map(entry => [entry.scope, entry.sql, entry.count])).toEqual([
      ['first', 'SELECT shared', 1],
      ['second', 'SELECT shared', 2],
    ]);
  });

  it('drain summarizes and starts an empty window; clear discards; a closed window records nothing', () => {
    const window = openStatementWindow(1000);
    recordSqlBusy('SELECT one', 5);
    expect(window.drain().unscoped?.statements).toBe(1);
    expect(window.drain()).toEqual({ scoped: null, unscoped: null });
    recordSqlBusy('SELECT two', 5);
    window.clear();
    expect(window.drain().unscoped).toBeNull();
    window.close();
    recordSqlBusy('SELECT three', 5);
    expect(window.drain()).toEqual({ scoped: null, unscoped: null });
  });

  it('a handle that was replaced neither drains nor closes the newer window', () => {
    const old = openStatementWindow(1000);
    const current = openStatementWindow(1000);
    recordSqlBusy('SELECT newer', 5);
    old.close();
    expect(old.drain()).toEqual({ scoped: null, unscoped: null });
    expect(current.drain().unscoped?.statements).toBe(1);
    current.close();
  });

  it('names the open scope that ran the latest statement, innermost first, and forgets it once it ends', () => {
    expect(describeOpenScopes()).toEqual({ openScopes: 0, lastSqlScope: null });
    const outer = startSqlScope('outer', quiet);
    const inner = outer.run(() => startSqlScope('inner', quiet));
    outer.run(() => recordSqlBusy('SELECT outer_only', 5));
    expect(describeOpenScopes().lastSqlScope?.scope).toBe('outer');
    inner.run(() => recordSqlBusy('SELECT inner', 7));
    const both = describeOpenScopes();
    expect(both.openScopes).toBe(2);
    expect(both.lastSqlScope).toMatchObject({ scope: 'inner', statements: 1 });
    inner.end();
    expect(describeOpenScopes().lastSqlScope?.scope).toBe('outer');
    outer.end();
    expect(describeOpenScopes()).toEqual({ openScopes: 0, lastSqlScope: null });
  });

  it('drops lastSqlScope when an unscoped statement is newer than every open scope\'s last statement', () => {
    const first = startSqlScope('first', quiet);
    const second = startSqlScope('second', quiet);
    first.run(() => recordSqlBusy('SELECT first', 2));
    second.run(() => recordSqlBusy('SELECT second', 2));
    expect(describeOpenScopes().lastSqlScope?.scope).toBe('second');
    recordSqlBusy('SELECT timer_unscoped', 2);
    expect(describeOpenScopes()).toMatchObject({ openScopes: 2, lastSqlScope: null });
    first.run(() => recordSqlBusy('SELECT first_again', 2));
    expect(describeOpenScopes().lastSqlScope?.scope).toBe('first');
    first.end();
    second.end();
  });

  it('does not list a scope that has run no statement as active', () => {
    const scope = startSqlScope('silent', quiet);
    expect(describeOpenScopes()).toEqual({ openScopes: 1, lastSqlScope: null });
    scope.end();
  });

  describe('open scopes are held weakly', () => {
    /** Starts a scope in its own frame and keeps no reference to it, as a caller that never ends it would. */
    function startAndForget(): void {
      startSqlScope('never-ends', quiet).run(() => recordSqlBusy('SELECT forgotten', 1));
    }

    async function collectUntil(done: () => boolean): Promise<void> {
      for (let attempt = 0; attempt < 20 && !done(); attempt++) {
        Bun.gc(true);
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
    }

    it('lets a scope that never ends and that nothing references be collected', async () => {
      const before = describeOpenScopes().openScopes;
      startAndForget();
      expect(describeOpenScopes().openScopes).toBe(before + 1);
      await collectUntil(() => describeOpenScopes().openScopes === before);
      expect(describeOpenScopes().openScopes).toBe(before);
    });

    it('still counts a live scope that is open, and removes it when it ends', async () => {
      const before = describeOpenScopes().openScopes;
      const live = startSqlScope('live', quiet);
      Bun.gc(true);
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      expect(describeOpenScopes().openScopes).toBe(before + 1);
      live.end();
      expect(describeOpenScopes().openScopes).toBe(before);
    });
  });
});
