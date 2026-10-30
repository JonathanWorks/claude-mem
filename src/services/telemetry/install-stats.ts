import type { Database } from 'bun:sqlite';

/** Telemetry is removed in the PWM fork: no install snapshot is collected. */
export function collectInstallStats(_db: Database): Record<string, number> {
  return {};
}
