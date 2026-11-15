#!/usr/bin/env bun
/**
 * Reopen tool uses a worker lost when it stopped, before the summary ledger existed (PWM fork).
 *
 * Until the ledger, the worker held unsummarized tool uses only in RAM, so a restart, crash or
 * reboot dropped them while their raw rows stayed in `tool_uses`. This marks those rows `pending`;
 * the running worker then replays them through its normal backlog admission.
 *
 * Usage: bun scripts/pwm-reopen-lost-tool-uses.ts --since <ISO time> --before <ISO time> [--db <path>] [--apply]
 * `--since` and `--before` are the start and stop of ONE worker lifetime (the "Worker started" lines
 * in ~/.claude-mem/logs). Run it once per lifetime. Without --apply it prints the counts and changes
 * nothing. A second run over the same window reopens nothing.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureToolUseSummaryColumns, reopenLostToolUses } from '../src/services/sqlite/tool-uses.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function epochArg(name: string): number {
  const value = argValue(name);
  const epoch = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(epoch)) {
    console.error(`pwm-reopen-lost-tool-uses: ${name} needs an ISO time, for example 2026-11-14T18:27:45-08:00`);
    process.exit(2);
  }
  return epoch;
}

const dbPath = argValue('--db') ?? join(homedir(), '.claude-mem', 'claude-mem.db');
if (!existsSync(dbPath)) {
  console.error(`pwm-reopen-lost-tool-uses: no database at ${dbPath}; pass --db <path>`);
  process.exit(2);
}
const sinceEpoch = epochArg('--since');
const beforeEpoch = epochArg('--before');
if (beforeEpoch <= sinceEpoch) {
  console.error('pwm-reopen-lost-tool-uses: --before must be later than --since');
  process.exit(2);
}
const apply = process.argv.includes('--apply');

const db = new Database(dbPath);
db.run('PRAGMA busy_timeout = 10000');
if (apply) ensureToolUseSummaryColumns(db);
const hasLedger = (db.prepare('PRAGMA table_info(tool_uses)').all() as Array<{ name: string }>)
  .some(column => column.name === 'summary_state');
if (!hasLedger) {
  console.error('pwm-reopen-lost-tool-uses: this database has no summary ledger yet; start the new worker once, or pass --apply');
  process.exit(2);
}
const result = reopenLostToolUses(db, { sinceEpoch, beforeEpoch, apply });
db.close();
console.log(`${apply ? 'reopened' : 'would reopen'} ${result.reopened} tool uses in ${result.sessions} sessions`);
