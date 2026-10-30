/**
 * Telemetry is removed in the PWM fork. The rollup buffer keeps upstream's method names so its
 * callers compile unchanged; every method is a no-op and nothing is retained or flushed.
 */

export type RollupReason = 'session_end' | 'worker_shutdown' | 'safety_flush';

export const telemetryBuffer = {
  record(
    _event: 'session_compressed' | 'context_injected' | 'work_state_usage',
    _sessionDbId: number | null,
    _props: Record<string, unknown>
  ): void {},
  flushSession(_sessionDbId: number, _reason: RollupReason): boolean {
    return false;
  },
  flush(): void {},
  start(_intervalMs: number = 5 * 60 * 1000): void {},
  stop(): void {},
};
