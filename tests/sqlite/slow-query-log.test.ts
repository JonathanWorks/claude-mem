import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';

import {
  instrumentSlowQueries,
  type SlowQueryContext,
} from '../../src/services/sqlite/slow-query-log.js';
import { runWithSqlScope, type SlowRequestContext } from '../../src/services/sqlite/sql-scope.js';
import { pageMatchingRows, streamRows } from '../../src/services/sqlite/stream-rows.js';

/** Each timed call reads the clock twice; its elapsed time is the next queued duration (default 0). */
function queuedClock(durations: number[]): () => number {
  let reads = 0;
  let time = 0;
  return () => {
    if (reads++ % 2 === 1) time += durations.shift() ?? 0;
    return time;
  };
}

/**
 * Whether this Bun sends a transaction's BEGIN and COMMIT through the instance's `run` or `exec`, where the log can see them.
 * Bun 1.4.x issues them natively, so no patched method is ever called for them and no logger of this shape can time them.
 */
function runtimeRoutesTransactionControlThroughPatchableMethods(): boolean {
  const probe = new Database(':memory:');
  try {
    probe.run('CREATE TABLE probe (id INTEGER)');
    const seen: string[] = [];
    for (const method of ['run', 'exec'] as const) {
      const original = probe[method].bind(probe) as (...args: unknown[]) => unknown;
      (probe as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => { seen.push(String(args[0])); return original(...args); };
    }
    probe.transaction(() => { probe.run('INSERT INTO probe VALUES (1)'); }).immediate();
    return seen.some(sql => /^BEGIN/i.test(sql));
  } finally {
    probe.close();
  }
}

describe('slow statement log', () => {
  let db: Database;
  let warnings: Array<{ message: string; context: SlowQueryContext }>;

  function instrument(durations: number[], thresholdMs = 500): Database {
    return instrumentSlowQueries(db, {
      thresholdMs,
      now: queuedClock(durations),
      warn: (message, context) => warnings.push({ message, context }),
    });
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, body TEXT)');
    warnings = [];
  });

  afterEach(() => db.close());

  it('warns once for a call above the threshold and not for one below it', () => {
    instrument([0, 100, 0, 600]);
    const statement = db.prepare('SELECT id FROM items');
    statement.all();
    expect(warnings).toHaveLength(0);

    db.prepare('SELECT id FROM items').all();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].context.op).toBe('all');
  });

  it('measures the statement call itself', () => {
    instrument([0, 600, 100]);
    const statement = db.prepare('SELECT id FROM items');
    statement.all();
    statement.get();
    expect(warnings.map(w => w.context.op)).toEqual(['all']);
    expect(warnings[0].context.elapsedMs).toBe(600);
    expect(warnings[0].context.thresholdMs).toBe(500);
  });

  it('does not warn at exactly the threshold', () => {
    instrument([0, 500, 501]);
    const statement = db.prepare('SELECT id FROM items');
    statement.all();
    statement.all();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].context.elapsedMs).toBe(501);
  });

  it('covers prepare, all, get, run, values, db.run, db.exec and db.query', () => {
    instrument(Array(10).fill(900));
    db.run('INSERT INTO items (body) VALUES (?)', ['a']);
    db.exec('DELETE FROM items WHERE id < 0');
    const statement = db.prepare('INSERT INTO items (body) VALUES (?)');
    statement.run('b');
    const reader = db.query('SELECT id, body FROM items');
    reader.all();
    reader.get();
    reader.values();
    const ops = warnings.map(w => w.context.op);
    expect(ops).toEqual(['db.run', 'db.exec', 'prepare', 'run', 'query', 'all', 'get', 'values']);
  });

  it('logs at most 300 whitespace-collapsed characters of SQL and names the caller', () => {
    instrument([900]);
    const columns = Array.from({ length: 80 }, (_, index) => `id AS column_number_${index}`).join(',\n      ');
    const sql = `SELECT\n      ${columns}\n    FROM items`;
    db.prepare(sql);
    const [{ context }] = warnings;
    expect(context.sql.length).toBeLessThanOrEqual(300);
    expect(context.sql).not.toMatch(/\s{2}|\n/);
    expect(context.sql.startsWith('SELECT id AS column_number_0, id AS column_number_1')).toBe(true);
    expect(context.caller).toContain('slow-query-log.test.ts');
  });

  it('lists the application frames in callers and keeps the logging modules out of them', () => {
    instrument([900]);
    db.prepare('SELECT id FROM items');
    const [{ context }] = warnings;
    expect(context.callers?.[0]).toBe(context.caller);
    expect(context.callers?.join('\n')).toContain('slow-query-log.test');
    expect(context.callers?.join('\n')).not.toMatch(/src\/services\/sqlite\/(?:slow-query-log|sql-scope|stack-source-map)/);
  });

  it('counts a slow statement and its siblings toward the enclosing SQL scope', () => {
    instrument([900, 40, 40]);
    const scoped: SlowRequestContext[] = [];
    runWithSqlScope('slow-test', () => {
      db.run('SELECT 1');
      db.run('SELECT 2');
      db.run('SELECT 3');
    }, { thresholdMs: 500, warn: (_message, context) => scoped.push(context) });
    expect(warnings).toHaveLength(1);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].statements).toBe(3);
    expect(scoped[0].sqlMs).toBe(980);
    expect(scoped[0].maxStatementMs).toBe(900);
  });

  it('counts an iterate toward the scope', () => {
    db.run("INSERT INTO items (body) VALUES ('a')");
    instrument([]);
    const scoped: SlowRequestContext[] = [];
    runWithSqlScope('iterate-test', () => {
      for (const _row of db.query('SELECT id FROM items').iterate()) void _row;
    }, { thresholdMs: -1, warn: (_message, context) => scoped.push(context) });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].top.map(entry => entry.sql)).toContain('SELECT id FROM items');
  });

  it('never puts a bound parameter in the message or the context', () => {
    instrument([0, 900]);
    const statement = db.prepare('INSERT INTO items (body) VALUES (?)');
    statement.run('SECRET_PROMPT_TEXT');
    db.run('INSERT INTO items (body) VALUES (?)', ['SECRET_PROMPT_TEXT']);
    expect(warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(warnings)).not.toContain('SECRET_PROMPT_TEXT');
  });

  it('times a statement that throws, logs it, and rethrows the original error', () => {
    db.run('CREATE UNIQUE INDEX items_body ON items (body)');
    db.run(`INSERT INTO items (body) VALUES ('dup')`);
    instrument([0, 900]);
    const statement = db.prepare('INSERT INTO items (body) VALUES (?)');
    expect(() => statement.run('dup')).toThrow(/UNIQUE constraint failed/);
    expect(warnings.map(w => w.context.op)).toEqual(['run']);
  });

  it('is idempotent and keeps the handle a Database', () => {
    const first = instrument([900]);
    const second = instrumentSlowQueries(db, { thresholdMs: 1, now: () => 0, warn: () => { throw new Error('second install must not log'); } });
    expect(second).toBe(first);
    expect(db instanceof Database).toBe(true);
    db.prepare('SELECT 1');
    expect(warnings).toHaveLength(1);
  });

  it('does not log a statement twice when query returns a cached statement', () => {
    instrument(Array(6).fill(900));
    const first = db.query('SELECT 1 AS one');
    const second = db.query('SELECT 1 AS one');
    expect(second).toBe(first);
    first.get();
    expect(warnings.map(w => w.context.op)).toEqual(['query', 'query', 'get']);
  });

  it.skipIf(!runtimeRoutesTransactionControlThroughPatchableMethods())('names the application frame, not a bun:sqlite frame, for transaction statements', () => {
    let reads = 0;
    instrumentSlowQueries(db, {
      thresholdMs: 500,
      now: () => (reads++ % 2 === 0 ? 0 : 900),
      warn: (message, context) => warnings.push({ message, context }),
    });
    db.transaction(() => {
      db.run('INSERT INTO items (body) VALUES (?)', ['t']);
    }).immediate();
    const begin = warnings.find(w => /BEGIN/i.test(w.context.sql));
    expect(begin).toBeDefined();
    for (const warning of warnings.filter(w => /^(BEGIN|COMMIT)/i.test(w.context.sql))) {
      expect(warning.context.caller).toContain('slow-query-log.test');
      expect(warning.context.caller).not.toContain('bun:sqlite');
      expect(warning.context.caller).not.toMatch(/^transaction /);
    }
  });

  it('times iterate over the whole iteration and reports first row, rows and caller', () => {
    for (const body of ['a', 'b', 'c']) db.run('INSERT INTO items (body) VALUES (?)', [body]);
    let clock = 0;
    let enabled = false;
    instrumentSlowQueries(db, {
      thresholdMs: 500,
      now: () => (enabled ? (clock += 200) : 0),
      warn: (message, context) => warnings.push({ message, context }),
    });
    const statement = db.prepare('SELECT body FROM items ORDER BY id');
    enabled = true;
    const seen: string[] = [];
    for (const row of statement.iterate() as Iterable<{ body: string }>) seen.push(row.body);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(warnings).toHaveLength(1);
    const [{ message, context }] = warnings;
    expect(message).toContain('op=iterate');
    expect(context.op).toBe('iterate');
    expect(context.rows).toBe(3);
    // clock reads: wall start 200, step reads 200 apart; each driver step is 200 ms busy
    expect(context.firstRowMs).toBe(400);
    expect(context.busyMs).toBe(1000);
    expect(context.wallMs).toBe(2200);
    expect(context.elapsedMs).toBe(context.wallMs);
    expect(context.sql).toContain('SELECT body FROM items');
    expect(context.caller).toContain('slow-query-log.test');
  });

  it('names the outer frame, not stream-rows, when iterate runs through streamRows and pageMatchingRows', () => {
    for (const body of ['a', 'b']) db.run('INSERT INTO items (body) VALUES (?)', [body]);
    let clock = 0;
    instrumentSlowQueries(db, {
      thresholdMs: 500,
      now: () => (clock += 600),
      warn: (message, context) => warnings.push({ message, context }),
    });
    const viaStream = db.prepare('SELECT body FROM items');
    const viaPage = db.prepare('SELECT body FROM items');
    warnings.length = 0;
    for (const row of streamRows(viaStream) as Iterable<unknown>) expect(row).toBeDefined();
    const page = pageMatchingRows<{ body: string }>(viaPage, [], () => true, { limit: 10 });
    expect(page).toHaveLength(2);
    expect(warnings.map(w => w.context.op)).toEqual(['iterate', 'iterate']);
    for (const warning of warnings) {
      expect(warning.context.caller).toContain('slow-query-log.test');
      expect(warning.context.caller).not.toContain('stream-rows');
    }
  });

  it('excludes consumer time from busyMs but includes it in wallMs, and warns on wallMs', () => {
    for (const body of ['a', 'b']) db.run('INSERT INTO items (body) VALUES (?)', [body]);
    let clock = 0;
    instrumentSlowQueries(db, {
      thresholdMs: 500,
      now: () => clock,
      warn: (message, context) => warnings.push({ message, context }),
    });
    const statement = db.prepare('SELECT body FROM items ORDER BY id');
    warnings.length = 0;
    let bodies = 0;
    for (const row of statement.iterate() as Iterable<unknown>) {
      expect(row).toBeDefined();
      bodies++;
      clock += 400;
    }
    expect(bodies).toBe(2);
    expect(warnings).toHaveLength(1);
    const [{ message, context }] = warnings;
    expect(context.busyMs).toBe(0);
    expect(context.wallMs).toBe(800);
    expect(context.rows).toBe(2);
    expect(message).toContain('wallMs=800');
  });

  it('logs an abandoned iterate and stays silent for a fast one', () => {
    db.run(`INSERT INTO items (body) VALUES ('x')`);
    db.run(`INSERT INTO items (body) VALUES ('y')`);
    let clock = 0;
    let step = 600;
    instrumentSlowQueries(db, {
      thresholdMs: 500,
      now: () => (clock += step),
      warn: (message, context) => warnings.push({ message, context }),
    });
    const statement = db.prepare('SELECT body FROM items');
    warnings.length = 0;
    for (const row of statement.iterate() as Iterable<unknown>) {
      expect(row).toBeDefined();
      break;
    }
    expect(warnings.map(w => w.context.op)).toEqual(['iterate']);
    expect(warnings[0].context.rows).toBe(1);

    warnings.length = 0;
    step = 1;
    for (const row of statement.iterate() as Iterable<unknown>) expect(row).toBeDefined();
    expect(warnings).toHaveLength(0);
  });

  it('leaves results unchanged', () => {
    instrument([]);
    db.run('INSERT INTO items (body) VALUES (?)', ['one']);
    expect(db.prepare('SELECT body FROM items').all()).toEqual([{ body: 'one' }]);
    expect(db.query('SELECT body FROM items').values()).toEqual([['one']]);
  });
});
