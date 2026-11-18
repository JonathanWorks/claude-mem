import type { Database, Statement } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { recordSqlBusy } from './sql-scope.js';
import { summarizeSql } from './sql-text.js';
import { callersOfSite, captureSite, takeHandedSite } from './stack-source-map.js';
import { resolveThresholdMsFromEnv } from './threshold-env.js';

export const DEFAULT_SLOW_QUERY_MS = 500;

const STATEMENT_METHODS = ['all', 'get', 'run', 'values'] as const;

export type SlowQueryOp = 'prepare' | 'query' | 'db.run' | 'db.exec' | 'all' | 'get' | 'run' | 'values' | 'iterate';

export interface SlowQueryContext {
  op: SlowQueryOp;
  elapsedMs: number;
  thresholdMs: number;
  sql: string;
  caller: string;
  /** The first few application frames, source-mapped when the bundle has a .map file. */
  callers?: string[];
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
 * The caller is named from a call site taken where the statement enters this module
 * (`captureSite`, called directly from each patched entry, never through a helper): the
 * site's first two frames are the capture and the entry, dropped by position, so no
 * function name is relied on and the minified worker bundle needs none. `streamRows` and
 * `pageMatchingRows` sit between the application and `iterate`, so they capture their own
 * site and hand it over (`withHandedSite`): the dropped frames are then the capture and
 * that helper, and the helper's raw bundle frame is never named as the caller. (The
 * `.all()` fallback of an old Bun without `iterate` names the helper's frame when no map
 * is available.) Remaining frames
 * are resolved through the bundle's .map file when it provably describes the running
 * bundle (see stack-source-map.ts) and filtered on the mapped source path; without a map
 * the raw bundle line and column are logged. Every timed statement also adds its busy time
 * to the active SQL scope (sql-scope.ts).
 * 'abandoned' is reported only when return() runs (a for-of break): an iterator advanced
 * and then dropped without return() never reaches the generator's finally and is not logged.
 * Known blind spots: an iterator that is never advanced logs nothing, and for-of
 * directly on a Statement (Bun's private Symbol.iterator path) is untimed; no src
 * caller does that today.
 */
export function instrumentSlowQueries(db: Database, options: SlowQueryLogOptions = {}): Database {
  if (instrumentedDatabases.has(db)) return db;
  instrumentedDatabases.add(db);

  const thresholdMs = options.thresholdMs ?? resolveThresholdMsFromEnv('CLAUDE_MEM_SLOW_QUERY_MS', DEFAULT_SLOW_QUERY_MS);
  const now = options.now ?? (() => performance.now());
  const warn = options.warn ?? defaultWarn;
  let depth = 0;

  /** `site` is undefined exactly when the entry was nested inside a timed call (depth > 0): that call is not timed. */
  function slowQueryTimed<T>(site: Error | undefined, op: SlowQueryOp, source: string | Statement, call: () => T): T {
    if (!site) return call();
    depth++;
    const startedAt = now();
    try {
      return call();
    } finally {
      depth--;
      const elapsedMs = now() - startedAt;
      const sql = typeof source === 'string' ? source : statementSql.get(source) ?? '';
      recordSqlBusy(sql, elapsedMs, site);
      if (elapsedMs > thresholdMs) {
        warn(`SLOW_QUERY | op=${op} | ms=${Math.round(elapsedMs)}`, {
          op,
          elapsedMs,
          thresholdMs,
          sql: summarizeSql(sql),
          ...callersOfSite(site),
        });
      }
    }
  }

  function* slowQueryIterate(
    statement: Statement,
    original: (...args: unknown[]) => Iterable<unknown>,
    args: unknown[],
    site: Error,
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
      const sql = statementSql.get(statement) ?? '';
      recordSqlBusy(sql, busyMs, site);
      if (busyMs > thresholdMs || wallMs > thresholdMs) {
        warn(`SLOW_QUERY | op=iterate | wallMs=${Math.round(wallMs)} | busyMs=${Math.round(busyMs)}`, {
          op: 'iterate',
          elapsedMs: wallMs,
          busyMs,
          wallMs,
          thresholdMs,
          sql: summarizeSql(sql),
          ...callersOfSite(site),
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
    const patchableStatement = statement as unknown as Record<string, unknown>;
    for (const method of STATEMENT_METHODS) {
      const original = patchableStatement[method] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function') continue;
      patchableStatement[method] = function slowQueryPatched(...args: unknown[]): unknown {
        const site = depth === 0 ? captureSite() : undefined;
        return slowQueryTimed(site, method, statement, () => original.apply(statement, args));
      };
    }
    const iterate = patchableStatement.iterate;
    if (typeof iterate === 'function') {
      patchableStatement.iterate = function slowQueryPatched(...args: unknown[]): unknown {
        const site = takeHandedSite() ?? captureSite();
        return slowQueryIterate(statement, iterate as (...a: unknown[]) => Iterable<unknown>, args, site);
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
      const site = depth === 0 ? captureSite() : undefined;
      const result = slowQueryTimed(site, op, sql, () => original.apply(db, args));
      return producesStatement ? instrumentStatement(result as Statement, sql) : result;
    };
  }
  return db;
}
