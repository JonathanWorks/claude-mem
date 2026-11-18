/**
 * A recorder for "which SQL runs on this thread", read from the SQL scope instrumentation (sql-scope.ts), not from patches of
 * Database or Statement objects. Every connection the worker opens goes through openSqliteDatabase, which instruments it
 * when it is opened; the instrumentation records each statement when it RUNS, so a connection opened before the watch began
 * is seen as well as one opened during it. (A patch of Database.prototype saw neither: bun installs its methods on each
 * instance, so a SessionStore or LocalReviewStore handle was invisible.) A worker thread is a separate JavaScript realm
 * with its own instrumentation, so only statements that ran on THIS thread are recorded here.
 *
 * The recorder classifies nothing. It does not parse SQL, plan it or decide what may run: a test that knows exactly which statements
 * a run makes compares what was recorded with those texts (as a multiset), and takes the plan of a read on the connection that ran it
 * with `explainOn` once the watch has ended. Every earlier attempt at a generic "is this entry safe" check was bypassed by the next
 * hostile entry (a comment, a quoted alias, a WITH clause, a range written as an equality, a multi-statement text, a trigger body, a
 * plan taken on another connection), so no such check is made here.
 *
 * What the instrumentation cannot see is a connection made by `new Database(...)` directly; tests/sqlite/sqlite-opener-coverage.test.ts
 * fails when a source module does that. A test's own fixture connection must go through `instrumentSlowQueries` to be seen.
 *
 * One limit: the recorded text is cut early. recordSqlBusy (sql-scope.ts) keys a statement on its first 300 RAW characters (SQL_KEY_LIMIT),
 * and the report then collapses whitespace (summarizeSql). A known text of N characters followed by 300 - N blanks (about 200 for the
 * ~100-character texts of the work view) and a second statement is therefore recorded as the known text alone: the witness trusts the
 * statement text beyond the recorded prefix. The run under test is the worker's own code, not an adversary, so this is accepted.
 */
import { Database } from 'bun:sqlite';
import { instrumentSlowQueries } from '../../src/services/sqlite/slow-query-log.js';
import { openStatementWindow, type SlowRequestContext, type StatementWindow } from '../../src/services/sqlite/sql-scope.js';
import { summarizeSql } from '../../src/services/sqlite/sql-text.js';

export interface WatchOptions {
  /** Most milliseconds all the statements recorded on this thread may add up to (the sum of their busy times). Required. */
  maxSqlMs: number;
}

export interface MainThreadStatements {
  /** Every statement the instrumentation recorded, scoped and unscoped. */
  total: number;
  /** The distinct statement texts recorded, with how often each ran. */
  seen: Array<{ sql: string; count: number }>;
  /** Busy time of every statement the instrumentation recorded on this thread (the canary excluded), in ms. */
  sqlMs: number;
  /** The busy time of the single costliest statement recorded on this thread, in ms (whole ms, as the window rounds it). */
  maxStatementMs: number;
  /** Set when the recorded time is over `maxSqlMs`, or the report could not name every statement; null otherwise. */
  problem: string | null;
}

const THRESHOLD_MS = 1000;
/** Run through an instrumented connection just before the report is read. The statement window is one global slot that anything
 * (the event-loop-lag monitor, another test) can replace; a replaced window reports nothing, which would read as "no statements". */
const CANARY_SQL = "SELECT 'main-thread-sql-witness canary'";

/** Start collecting. `finish()` stops, and reports every statement that ran on this thread since. */
export function watchMainThreadStatements(options: WatchOptions): { finish(): MainThreadStatements } {
  if (typeof options?.maxSqlMs !== 'number' || !Number.isFinite(options.maxSqlMs)) {
    throw new Error('watchMainThreadStatements needs options.maxSqlMs, a finite time budget in ms for all the SQL of the watch: without one nothing bounds what the run may cost.');
  }
  const window: StatementWindow = openStatementWindow(THRESHOLD_MS);
  const canaryDatabase = instrumentSlowQueries(new Database(':memory:'));
  return {
    finish() {
      // The window itemises its three costliest statements per side, so the run is drained BEFORE the canary runs: the canary
      // would otherwise take one of the three places and push a real statement out of the report.
      const report = window.drain();
      canaryDatabase.prepare(CANARY_SQL).get();
      canaryDatabase.close();
      const canaryReport = window.drain();
      window.close();
      const seen = new Map<string, number>();
      const problems: string[] = [];
      let total = 0, sqlMs = 0, maxStatementMs = 0;
      for (const side of [report.scoped, report.unscoped]) {
        if (!side) continue;
        total += side.statements;
        sqlMs += side.sqlMs;
        maxStatementMs = Math.max(maxStatementMs, side.maxStatementMs);
        const itemised = addTop(side, seen);
        // The report names its three costliest statements; a count that exceeds them is statements nobody can name.
        if (itemised < side.statements) problems.push(`${side.statements - itemised} more statements than the report itemises`);
      }
      // EXECUTION: the window was still ours at the end, so an empty report means nothing ran.
      const canary = summarizeSql(CANARY_SQL);
      const canarySeen = [canaryReport.scoped, canaryReport.unscoped].some(side => side?.top.some(entry => entry.sql === canary));
      if (!canarySeen) {
        throw new Error('The SQL statement window did not record the witness\'s own canary statement: another statement window replaced it, so this watch saw nothing.');
      }
      if (sqlMs > options.maxSqlMs) problems.push(`the statements took ${sqlMs} ms on this thread, over the ${options.maxSqlMs} ms budget`);
      return { total, seen: [...seen].map(([sql, count]) => ({ sql, count })), sqlMs, maxStatementMs, problem: problems.length > 0 ? problems.join('; ') : null };
    },
  };
}

/**
 * EXPLAIN QUERY PLAN of `sql` on `database`, one line per step. Call it on the connection object that RAN the statement (the store's
 * own handle, never one the test opens beside it) and after `finish()`, so the EXPLAIN is not itself a recorded statement.
 */
export function explainOn(database: Database, sql: string, params: unknown[]): string[] {
  const statement = database.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  try { return (statement.all(...params as never[]) as Array<{ detail: string }>).map(row => row.detail); } finally { statement.finalize(); }
}

/** The triggers on `tables` (main and temp schema of this connection), as `table.trigger` names. Empty means none. */
export function triggersOn(database: Database, tables: string[]): string[] {
  return ['sqlite_master', 'sqlite_temp_master'].flatMap(catalog =>
    tables.flatMap(table =>
      (database.prepare(`SELECT name FROM ${catalog} WHERE type = 'trigger' AND lower(tbl_name) = lower(?)`).all(table) as Array<{ name: string }>)
        .map(row => `${table}.${row.name}`)));
}

function addTop(side: SlowRequestContext, seen: Map<string, number>): number {
  let itemised = 0;
  for (const entry of side.top) {
    seen.set(entry.sql, (seen.get(entry.sql) ?? 0) + entry.count);
    itemised += entry.count;
  }
  return itemised;
}
