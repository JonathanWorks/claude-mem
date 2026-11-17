import { AsyncLocalStorage } from 'node:async_hooks';
import { isMainThread } from 'node:worker_threads';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { summarizeSql } from './sql-text.js';
import { callersOfSite, captureSite, type MapLoader } from './stack-source-map.js';
import { resolveThresholdMsFromEnv } from './threshold-env.js';

/**
 * Cumulative SQL time per unit of work. One slow statement is visible in the
 * SLOW_QUERY log; a stall made of hundreds of statements each under that
 * threshold is not. A scope (an HTTP request, a Chroma sync job) adds up the
 * busy time of every statement that runs inside it, across awaits, and logs one
 * SLOW_REQUEST warning when the total passes CLAUDE_MEM_SLOW_REQUEST_MS.
 * Statements that run outside any scope are summed per event-loop turn and
 * reported under the scope name 'unscoped-turn', which is how timer-driven work
 * shows up.
 */

export const DEFAULT_SLOW_REQUEST_MS = 1000;
export const UNSCOPED_TURN_SCOPE = 'unscoped-turn';

const MAX_DISTINCT_SQL = 64;
const OTHER_SQL_KEY = '(other)';
const SQL_KEY_LIMIT = 300;
const TOP_SQL = 3;
const ROUTE_NAME_LIMIT = 160;
const CALLER_CAPTURE_DIVISOR = 20;

export function threadName(): 'main' | 'worker' {
  return isMainThread ? 'main' : 'worker';
}

export interface SlowRequestContext {
  scope: string;
  thread: 'main' | 'worker';
  statements: number;
  sqlMs: number;
  wallMs: number;
  maxStatementMs: number;
  thresholdMs: number;
  top: Array<{ sql: string; count: number; ms: number; caller?: string; scope?: string }>;
}

export interface SqlScopeOptions {
  thresholdMs?: number;
  now?: () => number;
  warn?: (message: string, context: SlowRequestContext) => void;
  /** Source-map loader used to name callers when a warning is logged; tests inject a counter. */
  loadMap?: MapLoader;
  /** Unscoped bucket only: how the end-of-turn flush is scheduled (default setImmediate). */
  schedule?: (flush: () => void) => void;
}

interface SqlStats {
  count: number;
  ms: number;
  /** The SQL text this entry counts (a window entry's map key also carries its scope). */
  sql: string;
  /** Call site of the first statement that made this key hot; resolved to a caller only when a warning is logged. */
  site?: Error;
  /** Window entries only: the innermost open scope of the statements counted here; each scope has its own entry. */
  scope?: string;
}

interface ScopeState {
  name: string;
  parent: ScopeState | undefined;
  thresholdMs: number;
  now: () => number;
  warn: (message: string, context: SlowRequestContext) => void;
  loadMap: MapLoader | undefined;
  startedAt: number;
  closed: boolean;
  statements: number;
  sqlMs: number;
  maxMs: number;
  /** Sequence number of the latest statement recorded here; picks the most recently active open scope. */
  lastSeq: number;
  bySql: Map<string, SqlStats>;
}

const storage = new AsyncLocalStorage<ScopeState>();

function defaultWarn(message: string, context: SlowRequestContext): void {
  logger.warn('DB', message, { ...context });
}

function createState(name: string, parent: ScopeState | undefined, options: SqlScopeOptions): ScopeState {
  const now = options.now ?? (() => performance.now());
  return {
    name,
    parent,
    thresholdMs: options.thresholdMs ?? resolveThresholdMsFromEnv('CLAUDE_MEM_SLOW_REQUEST_MS', DEFAULT_SLOW_REQUEST_MS),
    now,
    warn: options.warn ?? defaultWarn,
    loadMap: options.loadMap,
    startedAt: now(),
    closed: false,
    statements: 0,
    sqlMs: 0,
    maxMs: 0,
    lastSeq: 0,
    bySql: new Map(),
  };
}

function resetState(state: ScopeState): void {
  state.startedAt = state.now();
  state.statements = 0;
  state.sqlMs = 0;
  state.maxMs = 0;
  state.lastSeq = 0;
  state.bySql.clear();
}

/**
 * Add one statement to `state` and return its per-key stats. A `scope` splits the key
 * by scope, so a window keeps the same SQL run under two scopes as two entries.
 */
function addToState(state: ScopeState, sqlKey: string, ms: number, scope: string | undefined): SqlStats {
  state.statements++;
  state.sqlMs += ms;
  if (ms > state.maxMs) state.maxMs = ms;
  let key = scope === undefined ? sqlKey : `${scope}\u0000${sqlKey}`;
  let sql = sqlKey;
  let entryScope = scope;
  if (!state.bySql.has(key) && state.bySql.size >= MAX_DISTINCT_SQL) {
    key = OTHER_SQL_KEY;
    sql = OTHER_SQL_KEY;
    entryScope = undefined;
  }
  let stats = state.bySql.get(key);
  if (!stats) {
    stats = { count: 0, ms: 0, sql, scope: entryScope };
    state.bySql.set(key, stats);
  }
  stats.count++;
  stats.ms += ms;
  return stats;
}

function needsSite(state: ScopeState, stats: SqlStats): boolean {
  return stats.site === undefined && stats.ms > state.thresholdMs / CALLER_CAPTURE_DIVISOR;
}

function summarize(state: ScopeState, finalName: string, wallMs: number): SlowRequestContext {
  const top = [...state.bySql.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, TOP_SQL)
    .map(([, stats]) => ({
      sql: summarizeSql(stats.sql),
      count: stats.count,
      ms: Math.round(stats.ms),
      caller: stats.site === undefined ? undefined : callersOfSite(stats.site, { limit: 1, loadMap: state.loadMap }).caller,
      scope: stats.scope,
    }));
  return {
    scope: finalName,
    thread: threadName(),
    statements: state.statements,
    sqlMs: Math.round(state.sqlMs),
    wallMs: Math.round(wallMs),
    maxStatementMs: Math.round(state.maxMs),
    thresholdMs: state.thresholdMs,
    top,
  };
}

function warnIfSlow(state: ScopeState, finalName: string, wallMs: number): SlowRequestContext | null {
  if (state.sqlMs <= state.thresholdMs) return null;
  const context = summarize(state, finalName, wallMs);
  state.warn(
    `SLOW_REQUEST | scope=${context.scope} | statements=${context.statements} | sqlMs=${context.sqlMs} | wallMs=${context.wallMs}`,
    context,
  );
  return context;
}

let unscoped: ScopeState | undefined;
let unscopedOptions: SqlScopeOptions = {};

/** Replace the injectable parts of the unscoped per-turn bucket; tests use it, the worker keeps the defaults. */
export function configureUnscopedSqlTurns(options: SqlScopeOptions = {}): void {
  unscopedOptions = options;
  unscoped = undefined;
}

function flushUnscoped(): void {
  const state = unscoped;
  unscoped = undefined;
  if (!state || state.statements === 0) return;
  state.closed = true;
  warnIfSlow(state, UNSCOPED_TURN_SCOPE, state.now() - state.startedAt);
}

function unscopedBucket(): ScopeState {
  if (!unscoped) {
    unscoped = createState(UNSCOPED_TURN_SCOPE, undefined, unscopedOptions);
    (unscopedOptions.schedule ?? setImmediate)(flushUnscoped);
  }
  return unscoped;
}

/**
 * Every statement since the event-loop-lag monitor's previous tick, scoped and
 * unscoped kept apart. A timer callback cannot see a scope through
 * AsyncLocalStorage, and scopes can stay open for minutes, so the stall that the
 * monitor reports is attributed from this window rather than from any scope.
 */
interface StatementWindowState {
  scoped: ScopeState;
  unscoped: ScopeState;
}

export interface StatementWindowReport {
  scoped: SlowRequestContext | null;
  unscoped: SlowRequestContext | null;
}

export interface StatementWindow {
  /** Summarize what ran since the last drain or clear (a side with no statements is null), then start a new window. */
  drain(): StatementWindowReport;
  /** Start a new window without summarizing the old one. */
  clear(): void;
  /** Stop collecting. Idempotent, and a no-op once another window was opened, so a stale handle never ends a newer window. */
  close(): void;
}

let statementWindow: StatementWindowState | undefined;

/** Start collecting; `thresholdMs` sets when a hot key records its call site. Replaces any window already open. */
export function openStatementWindow(thresholdMs: number): StatementWindow {
  const options: SqlScopeOptions = { thresholdMs };
  const own: StatementWindowState = {
    scoped: createState('window:scoped', undefined, options),
    unscoped: createState('window:unscoped', undefined, options),
  };
  statementWindow = own;
  const live = (): boolean => statementWindow === own;
  const clear = (): void => {
    if (!live()) return;
    resetState(own.scoped);
    resetState(own.unscoped);
  };
  const report = (state: ScopeState): SlowRequestContext | null =>
    state.statements === 0 ? null : summarize(state, state.name, state.now() - state.startedAt);
  return {
    drain: () => {
      if (!live()) return { scoped: null, unscoped: null };
      const drained = { scoped: report(own.scoped), unscoped: report(own.unscoped) };
      clear();
      return drained;
    },
    clear,
    close: () => {
      if (live()) statementWindow = undefined;
    },
  };
}

/** Scopes that have started and not ended; an end removes the scope, so a scope that never ends stays listed. */
const openScopes = new Set<ScopeState>();
let statementSeq = 0;
/** Sequence number of the latest statement that ran outside any open scope. */
let lastUnscopedSeq = 0;

export interface OpenScopesReport {
  openScopes: number;
  /**
   * The open scope that last ran scoped SQL, with its accumulated top SQL. It names where SQL
   * last ran, not what stalled: null when no open scope ran a statement, or when an unscoped
   * statement is newer than that scope's last one.
   */
  lastSqlScope: SlowRequestContext | null;
}

/**
 * What a timer callback can say about scopes, since it cannot see the async context of
 * the code that stalled: how many are open, and the one that last ran scoped SQL. That is
 * evidence of where SQL last ran, not proof of the stall's owner, so it is dropped when an
 * unscoped statement ran after it.
 */
export function describeOpenScopes(): OpenScopesReport {
  let latest: ScopeState | undefined;
  for (const state of openScopes) {
    if (state.lastSeq > 0 && (!latest || state.lastSeq >= latest.lastSeq)) latest = state;
  }
  return {
    openScopes: openScopes.size,
    lastSqlScope: latest && latest.lastSeq > lastUnscopedSeq ? summarize(latest, latest.name, latest.now() - latest.startedAt) : null,
  };
}

/** Reused by every call: statement recording is synchronous and never re-entrant. */
const recordTargets: ScopeState[] = [];

/**
 * Add one statement's busy time to the innermost scope and every open ancestor.
 * A statement with no OPEN scope in its chain (none active, or the scope already
 * ended, as for a detached generator loop that outlives its request) goes to the
 * unscoped per-turn bucket, so it is never dropped. Never throws.
 *
 * `site` is the call site made where the statement entered the instrumentation
 * (`captureSite`). A caller without one gets a site made here, only once a key is
 * hot: the frames are then `captureSite`, this function, the caller.
 */
export function recordSqlBusy(sql: string, ms: number, site?: Error): void {
  try {
    const sqlKey = sql.length > SQL_KEY_LIMIT ? sql.slice(0, SQL_KEY_LIMIT) : sql;
    recordTargets.length = 0;
    for (let state = storage.getStore(); state; state = state.parent) {
      if (!state.closed) recordTargets.push(state);
    }
    const scoped = recordTargets.length > 0;
    const scopeName = scoped ? recordTargets[0].name : UNSCOPED_TURN_SCOPE;
    if (!scoped) recordTargets.push(unscopedBucket());
    const windowState = statementWindow ? (scoped ? statementWindow.scoped : statementWindow.unscoped) : undefined;
    if (windowState) recordTargets.push(windowState);
    const seq = ++statementSeq;
    if (!scoped) lastUnscopedSeq = seq;
    for (const state of recordTargets) {
      state.lastSeq = seq;
      const stats = addToState(state, sqlKey, ms, state === windowState ? scopeName : undefined);
      if (!needsSite(state, stats)) continue;
      site ??= captureSite();
      stats.site = site;
    }
  } catch {
    // Accounting must never break a statement.
  } finally {
    recordTargets.length = 0;
  }
}

export interface SqlScope {
  run<T>(fn: () => T): T;
  end(finalName?: string): SlowRequestContext | null;
}

/** Begin a scope that nests under the active one. `end` is idempotent and logs when the total is slow. */
export function startSqlScope(name: string, options: SqlScopeOptions = {}): SqlScope {
  const state = createState(name, storage.getStore(), options);
  openScopes.add(state);
  return {
    run: <T>(fn: () => T): T => storage.run(state, fn),
    end: (finalName?: string): SlowRequestContext | null => {
      if (state.closed) return null;
      state.closed = true;
      openScopes.delete(state);
      return warnIfSlow(state, finalName ?? state.name, state.now() - state.startedAt);
    },
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** Run `fn` inside a scope; the scope ends when a synchronous result returns or a promise settles. */
export function runWithSqlScope<T>(name: string, fn: () => T, options: SqlScopeOptions = {}): T {
  const scope = startSqlScope(name, options);
  let result: T;
  try {
    result = scope.run(fn);
  } catch (error) {
    scope.end();
    throw error;
  }
  if (!isThenable(result)) {
    scope.end();
    return result;
  }
  return result.then(
    value => {
      scope.end();
      return value;
    },
    error => {
      scope.end();
      throw error;
    },
  ) as T;
}

function routeName(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const path = route?.path === undefined ? '(unmatched)' : String(route.path);
  return `${req.method} ${base}${path}`.slice(0, ROUTE_NAME_LIMIT);
}

/**
 * Express middleware that scopes one request. Mount it AFTER the body parser:
 * the parser resumes `next()` from stream callbacks, which can lose the async
 * context. The scope is named from the matched route pattern at the end, never
 * from the URL, because URLs carry ids and search text.
 */
export function sqlScopeMiddleware(options: SqlScopeOptions = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scope = startSqlScope('http', options);
    const finish = (): void => {
      scope.end(routeName(req));
    };
    res.once('finish', finish);
    res.once('close', finish);
    scope.run(() => next());
  };
}
