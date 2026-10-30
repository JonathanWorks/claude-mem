import type { Database } from 'bun:sqlite';

/** Telemetry is removed in the PWM fork: there is no historical telemetry backfill. */
export async function runHistoricalBackfill(_db: Database): Promise<void> {}
