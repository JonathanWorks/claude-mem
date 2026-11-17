import { logger } from '../../utils/logger.js';
import { describeOpenScopes, openStatementWindow, threadName, type SlowRequestContext } from './sql-scope.js';
import type { Unrefable } from './stack-source-map.js';
import { resolveThresholdMsFromEnv } from './threshold-env.js';

/**
 * Names what ran while the event loop could not. A SQL scope or the unscoped
 * per-turn bucket reports when it ENDS, so a stall inside a long-lived or
 * never-settling scope is logged late or never, and a stall with no SQL in it is
 * invisible to both. This monitor wakes on a timer, measures how late the wake-up
 * was, and when the lag passes the threshold logs one EVENT_LOOP_LAG line with the
 * top SQL of every statement since its previous tick (scoped and unscoped kept
 * apart; see sql-scope.ts) and the open scope that last ran scoped SQL (lastSqlScope: where SQL last ran, not proof of what stalled), with
 * that scope's accumulated top SQL. A lag with no SQL in the window is still
 * logged: that absence is the finding (a non-SQL stall), and a scope that is open
 * and has run SQL is named even when none ran in the stall window itself.
 */

export const DEFAULT_EVENT_LOOP_LAG_MS = 1000;
export const DEFAULT_EVENT_LOOP_TICK_MS = 100;

export interface EventLoopLagContext {
  thread: 'main' | 'worker';
  lagMs: number;
  thresholdMs: number;
  intervalMs: number;
  /** Scopes open at the tick (not ended yet). */
  openScopes: number;
  /** The open scope that last ran scoped SQL (not necessarily the stalled code); null when none did or an unscoped statement is newer. */
  lastSqlScope: SlowRequestContext | null;
  /** Statements that ran inside an open SQL scope during the stall window; null when there were none. */
  scoped: SlowRequestContext | null;
  /** Statements that ran outside any scope during the stall window; null when there were none. */
  unscoped: SlowRequestContext | null;
}

export interface EventLoopLagOptions {
  thresholdMs?: number;
  intervalMs?: number;
  now?: () => number;
  warn?: (message: string, context: EventLoopLagContext) => void;
  schedule?: (tick: () => void, intervalMs: number) => Unrefable;
  cancel?: (timer: Unrefable) => void;
}

export interface EventLoopLagMonitor {
  stop(): void;
}

let active: EventLoopLagMonitor | undefined;

function defaultWarn(message: string, context: EventLoopLagContext): void {
  logger.warn('SYSTEM', message, { ...context });
}

/**
 * Start the monitor on this thread. Started once per process: a second call
 * returns the running monitor and ignores its options. The timer is unref'd, so
 * it never keeps the process alive.
 */
export function startEventLoopLagMonitor(options: EventLoopLagOptions = {}): EventLoopLagMonitor {
  if (active) return active;
  const thresholdMs = options.thresholdMs ?? resolveThresholdMsFromEnv('CLAUDE_MEM_EVENT_LOOP_LAG_MS', DEFAULT_EVENT_LOOP_LAG_MS);
  const intervalMs = options.intervalMs ?? DEFAULT_EVENT_LOOP_TICK_MS;
  const now = options.now ?? (() => performance.now());
  const warn = options.warn ?? defaultWarn;
  const schedule = options.schedule ?? ((tick, delayMs) => setInterval(tick, delayMs));
  const cancel = options.cancel ?? ((timer: Unrefable) => clearInterval(timer as ReturnType<typeof setInterval>));

  const window = openStatementWindow(thresholdMs);
  let lastTickAt = now();
  const tick = (): void => {
    const tickAt = now();
    const lagMs = tickAt - lastTickAt - intervalMs;
    lastTickAt = tickAt;
    if (lagMs <= thresholdMs) {
      window.clear();
      return;
    }
    const { scoped, unscoped } = window.drain();
    const { openScopes, lastSqlScope } = describeOpenScopes();
    warn(
      `EVENT_LOOP_LAG | lagMs=${Math.round(lagMs)} | lastSqlScope=${lastSqlScope?.scope ?? 'none'} | openScopes=${openScopes} | scopedStatements=${scoped?.statements ?? 0} | unscopedStatements=${unscoped?.statements ?? 0}`,
      { thread: threadName(), lagMs: Math.round(lagMs), thresholdMs, intervalMs, openScopes, lastSqlScope, scoped, unscoped },
    );
  };
  const timer = schedule(tick, intervalMs);
  timer.unref?.();

  let stopped = false;
  const monitor: EventLoopLagMonitor = {
    /** Idempotent: a stale handle's second stop must not end the window of a monitor started since. */
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancel(timer);
      window.close();
      if (active === monitor) active = undefined;
    },
  };
  active = monitor;
  return monitor;
}
