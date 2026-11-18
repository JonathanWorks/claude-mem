/**
 * A witness for "no SQL runs on this thread", read from the SQL scope instrumentation (sql-scope.ts), not from patches of
 * Database or Statement objects. Every connection the worker opens goes through openSqliteDatabase, which instruments it
 * when it is opened; the instrumentation records each statement when it RUNS, so a connection opened before the watch began
 * is seen as well as one opened during it. (A patch of Database.prototype saw neither: bun installs its methods on each
 * instance, so a SessionStore or LocalReviewStore handle was invisible.) A worker thread is a separate JavaScript realm
 * with its own instrumentation, so only statements that ran on THIS thread are recorded here.
 *
 * What the instrumentation cannot see is a connection made by `new Database(...)` directly; tests/sqlite/sqlite-opener-coverage.test.ts
 * fails when a source module does that. A test's own fixture connection must go through `instrumentSlowQueries` to be seen.
 */
import { Database } from 'bun:sqlite';
import { instrumentSlowQueries } from '../../src/services/sqlite/slow-query-log.js';
import { openStatementWindow, type SlowRequestContext, type StatementWindow } from '../../src/services/sqlite/sql-scope.js';
import { summarizeSql } from '../../src/services/sqlite/sql-text.js';

/**
 * One statement the main thread may run during the watch: its EXACT text (whitespace aside), why it belongs there, and the EXACT
 * EXPLAIN QUERY PLAN a reviewer approved for it. The witness classifies nothing: it parses no SQL text and no plan text (every such
 * test has been bypassed: a comment, a quoted alias, a WITH clause, a range written as an equality). Each entry is planned on
 * `plan.database` (the real connection's handle, with the window already closed so the planning is not recorded) and the steps
 * must EQUAL `expectedPlan`, step for step. A read that drifts to a scan, a range, another index or a non-unique index no longer
 * equals what was approved and fails.
 *
 * An entry whose `expectedPlan` is empty (a plain INSERT ... VALUES has no plan step) is bounded by something else the planner does not
 * say, so it also needs `writesTables`, the tables it writes: none may hold a trigger (sqlite_master and sqlite_temp_master), and
 * the statement's bytecode (EXPLAIN) must be a single-row insert and nothing else: a PRAGMA, a DELETE without WHERE, a VACUUM or a
 * trigger or foreign-key program all plan to nothing and fail here. The bytecode test is an inclusion list: an opcode it does not
 * know fails, never passes.
 */
export interface AllowedStatement {
  sql: string;
  reason: string;
  expectedPlan: string[];
  writesTables?: string[];
  plan: { database: Database; params: unknown[] };
}

export interface WatchOptions {
  /** Most milliseconds the allowlisted statements, reads and writes alike, may add up to on this thread (the sum of their recorded busy times). Required. */
  maxAllowedMs: number;
}

export interface MainThreadStatements {
  /** Every statement the instrumentation recorded, scoped and unscoped. */
  total: number;
  /** The distinct statements recorded, with how often each ran. */
  seen: Array<{ sql: string; count: number }>;
  /** Busy time of every statement the instrumentation recorded on this thread (the canary excluded), in ms. */
  sqlMs: number;
  /** Busy time of the allowlisted statements alone, in ms. */
  allowedMs: number;
  /** EXPLAIN QUERY PLAN of each allowlisted statement, one line per step (none for a plain INSERT ... VALUES). */
  plans: Array<{ sql: string; steps: string[] }>;
  /** What is not on the allowlist, each as a line to read. Empty means the thread ran nothing it should not. */
  unexpected: string[];
}

const THRESHOLD_MS = 1000;
/** Run through an instrumented connection just before the report is read. The statement window is one global slot that anything
 * (the event-loop-lag monitor, another test) can replace; a replaced window reports nothing, which would read as "no statements". */
const CANARY_SQL = "SELECT 'main-thread-sql-witness canary'";

/** Start collecting. `finish()` stops, and reports every statement that ran on this thread since. */
export function watchMainThreadStatements(allowed: AllowedStatement[], options: WatchOptions): { finish(): MainThreadStatements } {
  if (typeof options?.maxAllowedMs !== 'number' || !Number.isFinite(options.maxAllowedMs)) {
    throw new Error('watchMainThreadStatements needs options.maxAllowedMs, a finite time budget in ms for the allowlisted statements: without one nothing bounds what the allowlist may cost.');
  }
  const window: StatementWindow = openStatementWindow(THRESHOLD_MS);
  const canaryDatabase = instrumentSlowQueries(new Database(':memory:'));
  const allowedSql = new Set(allowed.map(entry => summarizeSql(entry.sql)));
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
      const busy = new Map<string, number>();
      const planned = allowed.map(entry => ({ entry, planned: planEntry(entry) }));
      const unexpected: string[] = planned.flatMap(({ entry, planned: plan }) => entryProblems(entry, plan));
      let total = 0, sqlMs = 0;
      for (const side of [report.scoped, report.unscoped]) {
        if (!side) continue;
        total += side.statements;
        sqlMs += side.sqlMs;
        const itemised = addTop(side, seen, busy);
        // The report names its three costliest statements; a count that exceeds them is statements nobody can name.
        if (itemised < side.statements) unexpected.push(`${side.statements - itemised} more statements than the report itemises`);
      }
      // EXECUTION: the window was still ours at the end, so an empty report means nothing ran.
      const canary = summarizeSql(CANARY_SQL);
      const canarySeen = [canaryReport.scoped, canaryReport.unscoped].some(side => side?.top.some(entry => entry.sql === canary));
      if (!canarySeen) {
        throw new Error('The SQL statement window did not record the witness\'s own canary statement: another statement window replaced it, so this watch saw nothing.');
      }
      for (const sql of seen.keys()) if (!allowedSql.has(sql)) unexpected.push(sql);
      const plans = planned.filter(({ planned: plan }) => plan.steps).map(({ entry, planned: plan }) => ({ sql: summarizeSql(entry.sql), steps: plan.steps! }));
      const allowedMs = [...seen.keys()].filter(sql => allowedSql.has(sql)).reduce((sum, sql) => sum + (busy.get(sql) ?? 0), 0);
      if (allowedMs > options.maxAllowedMs) unexpected.push(`allowlisted statements took ${allowedMs.toFixed(2)} ms on this thread, over the ${options.maxAllowedMs} ms budget`);
      return { total, seen: [...seen].map(([sql, count]) => ({ sql, count })), sqlMs, allowedMs, plans, unexpected };
    },
  };
}

function planSteps(entry: Pick<AllowedStatement, 'sql' | 'plan'>): string[] {
  return readRows<{ detail: string }>(entry, 'EXPLAIN QUERY PLAN').map(row => row.detail);
}

/** The bytecode opcodes of an entry (EXPLAIN, which compiles the statement and never runs it). */
function opcodes(entry: Pick<AllowedStatement, 'sql' | 'plan'>): string[] {
  return readRows<{ opcode: string }>(entry, 'EXPLAIN').map(row => row.opcode);
}

/** The rows of `<prefix> <entry sql>` on the entry's plan database; the statement is finalized so it holds no lock on the schema. */
function readRows<Row>(entry: Pick<AllowedStatement, 'sql' | 'plan'>, prefix: string): Row[] {
  const statement = entry.plan.database.prepare(`${prefix} ${entry.sql}`);
  try { return statement.all(...entry.plan.params as never[]) as Row[]; } finally { statement.finalize(); }
}

/** An entry's plan, or why SQLite could not plan it (reported by entryProblems as a failure, never dropped). */
type Planned = { steps: string[]; error?: undefined } | { steps?: undefined; error: string };

function planEntry(entry: AllowedStatement): Planned {
  if (!entry.plan) return { error: 'has no query plan database' };
  try { return { steps: planSteps(entry) }; } catch (error) {
    return { error: `cannot be planned (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** summarizeSql keeps 300 characters: a longer entry could not be told from a statement that only begins like it. */
const MAX_EXACT_SQL_CHARS = 299;

/**
 * Every opcode a single-row INSERT ... VALUES into a trigger-free table compiles to. A statement whose bytecode holds anything else (a
 * Clear of DELETE without WHERE, a Pragma's ReadCookie or JournalMode, a trigger's Program, a Rewind loop) is not that, and fails.
 */
const SINGLE_ROW_INSERT_OPCODES = new Set([
  'Init', 'Goto', 'Halt', 'Transaction', 'OpenWrite', 'Noop', 'SoftNull', 'Variable', 'Integer', 'Int64', 'Real', 'String8', 'Null', 'Blob', 'Copy', 'SCopy', 'IntCopy',
  'NotNull', 'NewRowid', 'MustBeInt', 'NotExists', 'Affinity', 'MakeRecord', 'NoConflict', 'IdxInsert', 'Insert', 'Once',
]);

/** What is wrong with an allowlist entry itself, or with the plan it pinned, as lines to read. Empty: the entry holds. */
function entryProblems(entry: AllowedStatement, planned: Planned): string[] {
  const label = summarizeSql(entry.sql);
  const problems: string[] = [];
  if (entry.sql.replace(/\s+/g, ' ').trim().length > MAX_EXACT_SQL_CHARS) problems.push(`allowlisted statement is too long to match exactly: ${label}`);
  if (!Array.isArray(entry.expectedPlan)) return [...problems, `allowlisted statement pins no expected plan: ${label}`];
  if (planned.error !== undefined) return [...problems, `allowlisted statement ${planned.error}: ${label}`];
  const { steps } = planned;
  const pinned = entry.expectedPlan;
  if (steps.length !== pinned.length || steps.some((step, index) => step !== pinned[index])) {
    return [...problems, `plan drifted from the pinned one (pinned: [${pinned.join('; ')}], now: [${steps.join('; ')}]): ${label}`];
  }
  return pinned.length === 0 ? [...problems, ...emptyPlanProblems(entry, label)] : problems;
}

/** An empty plan bounds nothing by itself: the entry must be a bare single-row insert on tables with no trigger. */
function emptyPlanProblems(entry: AllowedStatement, label: string): string[] {
  const tables = entry.writesTables ?? [];
  if (tables.length === 0) return [`allowlisted statement has an empty plan and names no table it writes (writesTables): ${label}`];
  const database = entry.plan.database;
  const problems = tables.flatMap(table => ['sqlite_master', 'sqlite_temp_master'].flatMap(catalog =>
    (database.prepare(`SELECT name FROM ${catalog} WHERE type = 'trigger' AND lower(tbl_name) = lower(?)`).all(table) as Array<{ name: string }>)
      .map(row => `table ${table} has trigger ${row.name}, whose body this plan does not show: ${label}`)));
  const ops = opcodes(entry);
  const unknown = [...new Set(ops.filter(op => !SINGLE_ROW_INSERT_OPCODES.has(op)))];
  if (unknown.length > 0) problems.push(`empty plan, but the statement is not a bare single-row insert (opcodes ${unknown.join(', ')}): ${label}`);
  if (!ops.includes('Insert')) problems.push(`empty plan, and the statement inserts no row (a PRAGMA or a DELETE, for one): ${label}`);
  return problems;
}

function addTop(side: SlowRequestContext, seen: Map<string, number>, busy: Map<string, number>): number {
  let itemised = 0;
  for (const entry of side.top) {
    seen.set(entry.sql, (seen.get(entry.sql) ?? 0) + entry.count);
    busy.set(entry.sql, (busy.get(entry.sql) ?? 0) + entry.ms);
    itemised += entry.count;
  }
  return itemised;
}
