#!/usr/bin/env bun
/**
 * One-time history backfill for the self-hosted sync hub (PWM fork).
 *
 * Migration 47 records every pre-sync native row in sync_launch_exclusions and stamps it synced, so
 * the push drain never uploads history. This script requeues exactly those launch revisions
 * (synced_at = NULL) and clears the ledger, so the running worker uploads them on its next drain.
 * Replica rows (origin_device_id set) and quarantined rows (synced_at < 0) are never touched. The
 * hub upserts by entity, so a repeat run cannot create duplicates.
 *
 * Usage: bun scripts/pwm-sync-backfill.ts [--db <path>] [--apply]
 * Without --apply it prints the counts it would requeue and changes nothing.
 */
import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const TABLES = [
  { table: 'observations', kind: 'observation' },
  { table: 'session_summaries', kind: 'summary' },
  { table: 'user_prompts', kind: 'prompt' },
] as const;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbPath = argValue('--db') ?? join(homedir(), '.claude-mem', 'claude-mem.db');
const apply = process.argv.includes('--apply');
if (!existsSync(dbPath)) {
  console.error(`pwm-sync-backfill: no database at ${dbPath}; pass --db <path>`);
  process.exit(2);
}

const db = new Database(dbPath);
db.run('PRAGMA busy_timeout = 30000');
const ledger = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_launch_exclusions'"
).get();
if (!ledger) {
  console.error('pwm-sync-backfill: sync_launch_exclusions is missing; start the v15 worker once first');
  process.exit(2);
}

// Same revision comparison SyncApply.handleEpoch uses: revisions are decimal strings, so compare by
// length first, then lexically. A row edited after launch has a higher revision and is left alone.
const matchClause = (table: string) => `
  origin_device_id IS NULL AND synced_at > 0 AND EXISTS (
    SELECT 1 FROM sync_launch_exclusions AS launch
    WHERE launch.kind = ?
      AND launch.origin_local_id = CAST(${table}.id AS TEXT)
      AND (
        LENGTH(launch.through_rev) > LENGTH(CAST(${table}.sync_rev AS TEXT))
        OR (LENGTH(launch.through_rev) = LENGTH(CAST(${table}.sync_rev AS TEXT))
            AND launch.through_rev >= CAST(${table}.sync_rev AS TEXT))
      )
  )`;

const counts: Record<string, number> = {};
const run = db.transaction(() => {
  for (const { table, kind } of TABLES) {
    if (apply) {
      counts[table] = db.prepare(`UPDATE ${table} SET synced_at = NULL WHERE ${matchClause(table)}`)
        .run(kind).changes;
    } else {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${matchClause(table)}`)
        .get(kind) as { n: number };
      counts[table] = row.n;
    }
  }
  if (apply) db.run('DELETE FROM sync_launch_exclusions');
});
run();
db.close();

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const verb = apply ? 'requeued' : 'would requeue';
console.log(`pwm-sync-backfill: ${verb} ${total} rows ${JSON.stringify(counts)} in ${dbPath}`);
