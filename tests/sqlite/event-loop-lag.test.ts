import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  DEFAULT_EVENT_LOOP_LAG_MS,
  startEventLoopLagMonitor,
  type EventLoopLagContext,
  type EventLoopLagMonitor,
} from '../../src/services/sqlite/event-loop-lag.js';
import {
  configureUnscopedSqlTurns,
  recordSqlBusy,
  runWithSqlScope,
  type SlowRequestContext,
} from '../../src/services/sqlite/sql-scope.js';

function blockThread(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Deliberately holds the event loop: a stall is what the monitor exists to name.
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('event-loop lag monitor', () => {
  let monitor: EventLoopLagMonitor | undefined;
  let lags: Array<{ message: string; context: EventLoopLagContext }>;
  let requestWarnings: SlowRequestContext[];
  const warn = (message: string, context: EventLoopLagContext): void => {
    lags.push({ message, context });
  };

  beforeEach(() => {
    lags = [];
    requestWarnings = [];
    configureUnscopedSqlTurns({ thresholdMs: 1_000_000, warn: (_message, context) => requestWarnings.push(context) });
  });

  afterEach(() => {
    monitor?.stop();
    monitor = undefined;
    configureUnscopedSqlTurns();
  });

  describe('against the real event loop', () => {
    it('logs a 1.1 s synchronous block inside a still-open scope, with its top SQL, before the scope ends', async () => {
      const order: string[] = [];
      monitor = startEventLoopLagMonitor({
        intervalMs: 20,
        thresholdMs: DEFAULT_EVENT_LOOP_LAG_MS,
        warn: (message, context) => {
          order.push('lag-logged');
          warn(message, context);
        },
      });

      await runWithSqlScope('long-lived', async () => {
        await sleep(30);
        blockThread(1100);
        recordSqlBusy('SELECT heavy FROM observations WHERE project = ?', 1100);
        await sleep(60);
        order.push('scope-about-to-end');
      }, { thresholdMs: 100_000, warn: () => {} });
      order.push('scope-ended');

      expect(order).toEqual(['lag-logged', 'scope-about-to-end', 'scope-ended']);
      expect(lags).toHaveLength(1);
      const { message, context } = lags[0];
      expect(message).toContain('EVENT_LOOP_LAG');
      expect(context.lagMs).toBeGreaterThanOrEqual(1000);
      expect(context.scoped?.top[0]).toMatchObject({ sql: 'SELECT heavy FROM observations WHERE project = ?', count: 1, ms: 1100, scope: 'long-lived' });
      expect(context.scoped?.top[0].caller).toContain('event-loop-lag.test.ts');
      expect(context.unscoped).toBeNull();
    }, 15_000);

    it('names the open scope for a stall that ran no SQL in its own window: lastSqlScope=http, not none', async () => {
      monitor = startEventLoopLagMonitor({ intervalMs: 20, thresholdMs: 1000, warn });
      await runWithSqlScope('http', async () => {
        recordSqlBusy('SELECT early_one', 5);
        recordSqlBusy('SELECT early_two', 3);
        await sleep(80);
        blockThread(1200);
        await sleep(60);
      }, { thresholdMs: 100_000, warn: () => {} });

      expect(lags).toHaveLength(1);
      const { message, context } = lags[0];
      expect(message).toContain('lastSqlScope=http');
      expect(context.scoped).toBeNull();
      expect(context.openScopes).toBe(1);
      expect(context.lastSqlScope).toMatchObject({ scope: 'http', statements: 2 });
      expect(context.lastSqlScope?.top.map(entry => entry.sql)).toEqual(['SELECT early_one', 'SELECT early_two']);
    }, 15_000);

    it('reads lastSqlScope=none when no open scope ran a statement', async () => {
      monitor = startEventLoopLagMonitor({ intervalMs: 20, thresholdMs: 1000, warn });
      await runWithSqlScope('idle-scope', async () => {
        await sleep(30);
        blockThread(1100);
        await sleep(60);
      }, { thresholdMs: 100_000, warn: () => {} });
      expect(lags).toHaveLength(1);
      expect(lags[0].message).toContain('lastSqlScope=none');
      expect(lags[0].context.lastSqlScope).toBeNull();
      expect(lags[0].context.openScopes).toBe(1);
    }, 15_000);

    it('logs a stall that ran no SQL, naming no statements', async () => {
      monitor = startEventLoopLagMonitor({ intervalMs: 20, thresholdMs: 1000, warn });
      await sleep(30);
      blockThread(1100);
      await sleep(60);
      expect(lags).toHaveLength(1);
      expect(lags[0].context.scoped).toBeNull();
      expect(lags[0].context.unscoped).toBeNull();
      expect(lags[0].message).toContain('scopedStatements=0');
    }, 15_000);

    it('names unscoped statements apart from scoped ones', async () => {
      monitor = startEventLoopLagMonitor({ intervalMs: 20, thresholdMs: 1000, warn });
      await sleep(30);
      blockThread(1100);
      recordSqlBusy('SELECT timer_work', 1100);
      await sleep(60);
      expect(lags).toHaveLength(1);
      expect(lags[0].context.scoped).toBeNull();
      expect(lags[0].context.unscoped?.top[0]).toMatchObject({ sql: 'SELECT timer_work', ms: 1100 });
    }, 15_000);

    it('stays quiet for a block shorter than the threshold', async () => {
      monitor = startEventLoopLagMonitor({ intervalMs: 20, thresholdMs: 1000, warn });
      await sleep(30);
      blockThread(300);
      await sleep(60);
      expect(lags).toHaveLength(0);
    });
  });

  describe('with an injected clock and timer', () => {
    function fakeLoop() {
      let time = 0;
      const timers: Array<{ tick: () => void; intervalMs: number; unref: number; cancelled: boolean }> = [];
      const options = {
        intervalMs: 100,
        thresholdMs: 1000,
        warn,
        now: () => time,
        schedule: (tick: () => void, intervalMs: number) => {
          const timer = { tick, intervalMs, unref: 0, cancelled: false };
          timers.push(timer);
          return { unref: () => { timer.unref++; } };
        },
        cancel: () => { timers[timers.length - 1].cancelled = true; },
      };
      const advance = (ms: number): void => {
        time += ms;
        timers[0].tick();
      };
      return { options, timers, advance };
    }

    it('unrefs its timer and is started once: a second start returns the running monitor', () => {
      const { options, timers } = fakeLoop();
      monitor = startEventLoopLagMonitor(options);
      expect(timers).toHaveLength(1);
      expect(timers[0].unref).toBe(1);
      expect(startEventLoopLagMonitor(options)).toBe(monitor);
      expect(timers).toHaveLength(1);
    });

    it('measures lag as the tick delay beyond the interval and logs only past the threshold', () => {
      const { options, advance } = fakeLoop();
      monitor = startEventLoopLagMonitor(options);
      advance(100);
      advance(1100);
      expect(lags).toHaveLength(0);
      advance(1101 + 100);
      expect(lags).toHaveLength(1);
      expect(lags[0].context.lagMs).toBe(1101);
      advance(100);
      expect(lags).toHaveLength(1);
    });

    it('takes the statement window from the stall, not from before the previous tick', () => {
      const { options, advance } = fakeLoop();
      monitor = startEventLoopLagMonitor(options);
      recordSqlBusy('SELECT before_previous_tick', 5);
      advance(100);
      recordSqlBusy('SELECT during_stall', 5);
      advance(100 + 1500);
      const sql = lags[0].context.unscoped?.top.map(entry => entry.sql);
      expect(sql).toEqual(['SELECT during_stall']);
    });

    it('stop cancels the timer and allows a fresh start', () => {
      const { options, timers } = fakeLoop();
      monitor = startEventLoopLagMonitor(options);
      const first = monitor;
      first.stop();
      expect(timers[0].cancelled).toBe(true);
      monitor = startEventLoopLagMonitor(fakeLoop().options);
      expect(monitor).not.toBe(first);
    });

    it('stop is idempotent: a stale stop does not end the statement window of the monitor started after it', () => {
      const first = fakeLoop();
      const a = startEventLoopLagMonitor(first.options);
      a.stop();
      const second = fakeLoop();
      monitor = startEventLoopLagMonitor(second.options);
      expect(monitor).not.toBe(a);
      a.stop();
      expect(second.timers[0].cancelled).toBe(false);
      recordSqlBusy('SELECT for_the_second_monitor', 5);
      second.advance(100 + 1500);
      expect(lags).toHaveLength(1);
      expect(lags[0].context.unscoped?.statements).toBe(1);
      expect(lags[0].message).toContain('unscopedStatements=1');
      expect(first.timers[0].cancelled).toBe(true);
    });

    it('stopping twice cancels its timer once', () => {
      let cancels = 0;
      const { options } = fakeLoop();
      const a = startEventLoopLagMonitor({ ...options, cancel: () => { cancels++; } });
      a.stop();
      a.stop();
      expect(cancels).toBe(1);
    });

    it('records no statement window once stopped', () => {
      const { options } = fakeLoop();
      monitor = startEventLoopLagMonitor(options);
      monitor.stop();
      monitor = undefined;
      recordSqlBusy('SELECT after_stop', 5);
      const second = fakeLoop();
      monitor = startEventLoopLagMonitor(second.options);
      second.advance(100 + 2000);
      expect(lags[0].context.unscoped).toBeNull();
    });
  });
});
