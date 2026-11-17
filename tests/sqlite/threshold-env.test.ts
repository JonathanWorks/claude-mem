import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';

import {
  DEFAULT_EVENT_LOOP_LAG_MS,
  startEventLoopLagMonitor,
  type EventLoopLagContext,
} from '../../src/services/sqlite/event-loop-lag.js';
import { DEFAULT_SLOW_QUERY_MS, instrumentSlowQueries, type SlowQueryContext } from '../../src/services/sqlite/slow-query-log.js';
import { DEFAULT_SLOW_REQUEST_MS, startSqlScope, recordSqlBusy } from '../../src/services/sqlite/sql-scope.js';
import { resolveThresholdMsFromEnv } from '../../src/services/sqlite/threshold-env.js';

const VARIABLES = ['CLAUDE_MEM_SLOW_QUERY_MS', 'CLAUDE_MEM_SLOW_REQUEST_MS', 'CLAUDE_MEM_EVENT_LOOP_LAG_MS'] as const;

describe('resolveThresholdMsFromEnv', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of VARIABLES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARIABLES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('returns the fallback for unset, empty, zero, negative, junk and non-finite values', () => {
    expect(resolveThresholdMsFromEnv('CLAUDE_MEM_SLOW_QUERY_MS', 42)).toBe(42);
    for (const raw of ['', '0', '-1', 'abc', 'Infinity', 'NaN']) expect(resolveThresholdMsFromEnv('X', 42, { X: raw })).toBe(42);
  });

  it('returns a finite positive number, fractions included', () => {
    expect(resolveThresholdMsFromEnv('X', 42, { X: '250' })).toBe(250);
    expect(resolveThresholdMsFromEnv('X', 42, { X: '0.5' })).toBe(0.5);
  });

  it('reads process.env by default', () => {
    process.env.CLAUDE_MEM_SLOW_QUERY_MS = '123';
    expect(resolveThresholdMsFromEnv('CLAUDE_MEM_SLOW_QUERY_MS', 42)).toBe(123);
  });

  describe('is the one rule behind all three threshold variables, through each consumer', () => {
    function slowQueryWarnings(): SlowQueryContext[] {
      const logged: SlowQueryContext[] = [];
      let clock = 0;
      const db = instrumentSlowQueries(new Database(':memory:'), {
        now: () => (clock += 200),
        warn: (_message, context) => logged.push(context),
      });
      db.query('SELECT 1').all();
      db.close();
      return logged;
    }

    function slowRequestWarnings(): number {
      let warned = 0;
      const scope = startSqlScope('threshold-env', { warn: () => { warned++; } });
      scope.run(() => recordSqlBusy('SELECT 1', 300));
      scope.end();
      return warned;
    }

    function lagWarnings(): EventLoopLagContext[] {
      const logged: EventLoopLagContext[] = [];
      let time = 0;
      let tick: () => void = () => {};
      const monitor = startEventLoopLagMonitor({
        intervalMs: 100,
        now: () => time,
        warn: (_message, context) => logged.push(context),
        schedule: callback => {
          tick = callback;
          return {};
        },
        cancel: () => {},
      });
      time = 100 + 300;
      tick();
      monitor.stop();
      return logged;
    }

    it('applies the defaults when the variables are unset or junk', () => {
      expect([DEFAULT_SLOW_QUERY_MS, DEFAULT_SLOW_REQUEST_MS, DEFAULT_EVENT_LOOP_LAG_MS]).toEqual([500, 1000, 1000]);
      for (const raw of [undefined, 'abc', '0', '-3']) {
        for (const name of VARIABLES) {
          if (raw === undefined) delete process.env[name];
          else process.env[name] = raw;
        }
        expect(slowQueryWarnings()).toHaveLength(0);
        expect(slowRequestWarnings()).toBe(0);
        expect(lagWarnings()).toHaveLength(0);
      }
    });

    it('lowers each threshold below its observed value when the variable says so', () => {
      process.env.CLAUDE_MEM_SLOW_QUERY_MS = '150';
      process.env.CLAUDE_MEM_SLOW_REQUEST_MS = '250';
      process.env.CLAUDE_MEM_EVENT_LOOP_LAG_MS = '50';
      const [query] = slowQueryWarnings();
      expect(query.thresholdMs).toBe(150);
      expect(slowRequestWarnings()).toBe(1);
      const [lag] = lagWarnings();
      expect(lag.thresholdMs).toBe(50);
    });
  });
});
