import type { Database, Statement } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export const DEFAULT_SLOW_QUERY_MS = 500;

const SQL_LOG_LIMIT = 300;
const SQL_SCAN_LIMIT = 4000;
const CALLER_LOG_LIMIT = 240;
const OWN_FRAME =
  /slow-query-log\.(?:ts|js|mjs|cjs)|stream-rows\.(?:ts|js|mjs|cjs)|slowQuery(?:Caller|Timed|Patched|Iterate)|bun:sqlite|node:internal/;
const STATEMENT_METHODS = ['all', 'get', 'run', 'values'] as const;

export type SlowQueryOp = 'prepare' | 'query' | 'db.run' | 'db.exec' | 'all' | 'get' | 'run' | 'values' | 'iterate';

export interface SlowQueryContext {
  op: SlowQueryOp;
  elapsedMs: number;
  thresholdMs: number;
  sql: string;
  caller: string;
  /** iterate only: summed ms spent inside the driver producing rows (consumer time excluded). */
  busyMs?: number;
  /** iterate only: wall ms from the first clock read to the iteration ending (consumer time included). */
  wallMs?: number;
  /** iterate only: driver busy ms until the first row arrived. */
  firstRowMs?: number;
  /** iterate only: rows yielded before the iteration ended. */
  rows?: number;
}

export interface SlowQueryLogOptions {
  thresholdMs?: number;
  now?: () => number;
  warn?: (message: string, context: SlowQueryContext) => void;
}

const instrumentedDatabases = new WeakSet<object>();
const instrumentedStatements = new WeakSet<object>();
const statementSql = new WeakMap<object, string>();

export function resolveSlowQueryThresholdMs(raw: string | undefined = process.env.CLAUDE_MEM_SLOW_QUERY_MS): number {
  if (raw === undefined) return DEFAULT_SLOW_QUERY_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_QUERY_MS;
}

function summarizeSql(sql: string): string {
  return sql.slice(0, SQL_SCAN_LIMIT).replace(/\s+/g, ' ').trim().slice(0, SQL_LOG_LIMIT);
}

function slowQueryCaller(): string {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  const caller = frames.find(frame => frame.includes('at ') && !OWN_FRAME.test(frame));
  return caller ? caller.trim().replace(/^at\s+/, '').slice(0, CALLER_LOG_LIMIT) : 'unknown';
}

function defaultWarn(message: string, context: SlowQueryContext): void {
  logger.warn('DB', message, { ...context });
}

function sqlArgument(args: unknown[]): string {
  return typeof args[0] === 'string' ? args[0] : '';
}

/**
 * Time every statement call on `db` and warn when one runs longer than the
 * threshold (CLAUDE_MEM_SLOW_QUERY_MS, default 500 ms). The warning carries the
 * first 300 characters of the SQL text and the calling frame; bound parameters
 * are never read, because they can hold prompt text. Patches the instance
 * rather than wrapping it, so `db instanceof Database` still holds. Idempotent.
 *
 * `Statement.iterate()` is timed as op=iterate and reported when the iteration
 * completes, throws or is abandoned. It carries busyMs (time inside the driver
 * producing rows, consumer time excluded) and wallMs (first clock read to the end,
 * consumer time included, so a cursor held open across slow consumer work is
 * visible); it warns when EITHER exceeds the threshold. elapsedMs equals wallMs.
 * Frames inside bun:sqlite, node:internal and stream-rows are skipped when naming
 * the caller, so the frame reported is the application frame that drives the iteration.
 * 'abandoned' is reported only when return() runs (a for-of break): an iterator advanced
 * and then dropped without return() never reaches the generator's finally and is not logged.
 * Known blind spots: an iterator that is never advanced logs nothing, and for-of
 * directly on a Statement (Bun's private Symbol.iterator path) is untimed; no src
 * caller does that today.
 */
export function instrumentSlowQueries(db: Database, options: SlowQueryLogOptions = {}): Database {
  if (instrumentedDatabases.has(db)) return db;
  instrumentedDatabases.add(db);

  const thresholdMs = options.thresholdMs ?? resolveSlowQueryThresholdMs();
  const now = options.now ?? (() => performance.now());
  const warn = options.warn ?? defaultWarn;
  let depth = 0;

  function slowQueryTimed<T>(op: SlowQueryOp, sql: () => string, call: () => T): T {
    if (depth > 0) return call();
    depth++;
    const startedAt = now();
    try {
      return call();
    } finally {
      depth--;
      const elapsedMs = now() - startedAt;
      if (elapsedMs > thresholdMs) {
        const sqlText = summarizeSql(sql());
        warn(`SLOW_QUERY | op=${op} | ms=${Math.round(elapsedMs)}`, {
          op,
          elapsedMs,
          thresholdMs,
          sql: sqlText,
          caller: slowQueryCaller(),
        });
      }
    }
  }

  function* slowQueryIterate(
    statement: Statement,
    original: (...args: unknown[]) => Iterable<unknown>,
    args: unknown[],
  ): Generator<unknown> {
    let busyMs = 0;
    const startedAt = now();
    let firstRowMs: number | undefined;
    let rows = 0;
    const step = <T>(call: () => T): T => {
      const stepStartedAt = now();
      try {
        return call();
      } finally {
        busyMs += now() - stepStartedAt;
      }
    };
    try {
      const iterator = step(() => original.apply(statement, args)[Symbol.iterator]());
      for (;;) {
        const next = step(() => iterator.next());
        if (next.done) return;
        if (firstRowMs === undefined) firstRowMs = busyMs;
        rows++;
        yield next.value;
      }
    } finally {
      const wallMs = now() - startedAt;
      if (busyMs > thresholdMs || wallMs > thresholdMs) {
        warn(`SLOW_QUERY | op=iterate | wallMs=${Math.round(wallMs)} | busyMs=${Math.round(busyMs)}`, {
          op: 'iterate',
          elapsedMs: wallMs,
          busyMs,
          wallMs,
          thresholdMs,
          sql: summarizeSql(statementSql.get(statement) ?? ''),
          caller: slowQueryCaller(),
          firstRowMs,
          rows,
        });
      }
    }
  }

  const instrumentStatement = (statement: Statement, sql: string): Statement => {
    if (!statementSql.has(statement)) statementSql.set(statement, sql);
    if (instrumentedStatements.has(statement)) return statement;
    instrumentedStatements.add(statement);
    for (const method of STATEMENT_METHODS) {
      const original = (statement as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
      if (typeof original !== 'function') continue;
      (statement as unknown as Record<string, unknown>)[method] = function slowQueryPatched(...args: unknown[]): unknown {
        return slowQueryTimed(method, () => statementSql.get(statement) ?? '', () => original.apply(statement, args));
      };
    }
    const iterate = (statement as unknown as Record<string, unknown>).iterate;
    if (typeof iterate === 'function') {
      (statement as unknown as Record<string, unknown>).iterate = function slowQueryPatched(...args: unknown[]): unknown {
        return slowQueryIterate(statement, iterate as (...a: unknown[]) => Iterable<unknown>, args);
      };
    }
    return statement;
  };

  const patchable = db as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [method, op, producesStatement] of [
    ['prepare', 'prepare', true],
    ['query', 'query', true],
    ['run', 'db.run', false],
    ['exec', 'db.exec', false],
  ] as const) {
    const original = patchable[method];
    if (typeof original !== 'function') continue;
    patchable[method] = function slowQueryPatched(...args: unknown[]): unknown {
      const sql = sqlArgument(args);
      const result = slowQueryTimed(op, () => sql, () => original.apply(db, args));
      return producesStatement ? instrumentStatement(result as Statement, sql) : result;
    };
  }
  return db;
}
