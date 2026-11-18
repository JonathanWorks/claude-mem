import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { startEventLoopLagMonitor, type EventLoopLagMonitor } from '../../src/services/sqlite/event-loop-lag.js';
import { configureUnscopedSqlTurns, formatTopSql, recordSqlBusy, startSqlScope, runWithSqlScope } from '../../src/services/sqlite/sql-scope.js';
import { logger } from '../../src/utils/logger.js';

// The other lag and scope tests inject `warn`, so they never reach the logger that formats the line. This one goes
// through the real logger and reads the line it would have written: a nested object would print as `{N keys: ...}`.
type LoggerInternals = { ensureLogFileInitialized(): void; appendLine(path: string, text: string): void; logFilePath: string | null };

let lines: string[];
let monitor: EventLoopLagMonitor | undefined;
let restore: () => void;

beforeEach(() => {
  lines = [];
  const internals = logger as unknown as LoggerInternals;
  const original = { ensure: internals.ensureLogFileInitialized, append: internals.appendLine, path: internals.logFilePath };
  internals.ensureLogFileInitialized = function ensureForTest(this: LoggerInternals) { this.logFilePath = 'captured.log'; };
  internals.appendLine = (_path: string, text: string) => { lines.push(text.trimEnd()); };
  restore = () => {
    internals.ensureLogFileInitialized = original.ensure;
    internals.appendLine = original.append;
    internals.logFilePath = original.path;
  };
  configureUnscopedSqlTurns({ thresholdMs: 1_000_000, warn: () => {} });
});

afterEach(() => {
  monitor?.stop();
  monitor = undefined;
  configureUnscopedSqlTurns();
  restore();
});

describe('the real logger names statements and scopes', () => {
  it('writes an EVENT_LOOP_LAG line that carries SQL text, scope names and the caller', () => {
    let clock = 0;
    let tick: () => void = () => {};
    monitor = startEventLoopLagMonitor({
      thresholdMs: 1000, intervalMs: 100, now: () => clock,
      schedule: callback => { tick = callback; return {}; }, cancel: () => {},
    });
    runWithSqlScope('work-view.poll', () => recordSqlBusy('SELECT scoped_probe FROM tool_uses WHERE tool_name = ?', 700));
    recordSqlBusy('SELECT unscoped_probe FROM user_prompts', 900);
    clock = 3000;
    tick();

    const line = lines.find(entry => entry.includes('EVENT_LOOP_LAG'));
    expect(line).toBeDefined();
    expect(line).toContain('SELECT scoped_probe FROM tool_uses WHERE tool_name = ?');
    expect(line).toContain('SELECT unscoped_probe FROM user_prompts');
    expect(line).toContain('scope=work-view.poll');
    expect(line).toContain('caller=');
    expect(line).toContain('lag-real-logger.test.ts');
    expect(line).toContain('scopedStatements=1');
    expect(line).not.toMatch(/\d+ keys:/);
    expect(line).not.toContain('[Object]');
  });

  it('writes a SLOW_REQUEST line that carries the top SQL, its scope name and its caller', () => {
    const scope = startSqlScope('http', { thresholdMs: 100 });
    scope.run(() => recordSqlBusy('SELECT slow_probe FROM observations', 400));
    scope.end('GET /api/work-view');

    const line = lines.find(entry => entry.includes('SLOW_REQUEST'));
    expect(line).toBeDefined();
    expect(line).toContain('scope=GET /api/work-view');
    expect(line).toContain('SELECT slow_probe FROM observations (x1, 400ms');
    expect(line).toContain('lag-real-logger.test.ts');
    expect(line).not.toMatch(/\d+ keys:/);
  });

  it('formatTopSql bounds the line: three entries, each with its SQL', () => {
    const top = [1, 2, 3].map(index => ({ sql: `SELECT ${index}`, count: index, ms: index * 10 }));
    expect(formatTopSql([])).toBe('[]');
    expect(formatTopSql(top)).toBe('[SELECT 1 (x1, 10ms) ; SELECT 2 (x2, 20ms) ; SELECT 3 (x3, 30ms)]');
  });
});
