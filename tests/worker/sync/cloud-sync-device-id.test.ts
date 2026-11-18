// The device id is configuration: the work view reads it on the main thread on every publish and refresh,
// so the accessor must run no SQL (status() runs COUNT(*) queries over the outboxes).

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { instrumentSlowQueries } from '../../../src/services/sqlite/slow-query-log.js';
import { CloudSync } from '../../../src/services/sync/CloudSync.js';
import { watchMainThreadStatements } from '../../helpers/main-thread-sql-witness.js';

const DEVICE_ID = 'device-fixture';

describe('CloudSync.localDeviceId', () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-mem-sync-device-'));
    db = instrumentSlowQueries(new Database(':memory:'));
    new SessionStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeSync(configured: boolean): CloudSync {
    return new CloudSync(db, configured
      ? {
        CLAUDE_MEM_CLOUD_SYNC_TOKEN: 'test-token-1234',
        CLAUDE_MEM_CLOUD_SYNC_USER_ID: 'user-42',
        CLAUDE_MEM_CLOUD_SYNC_HUB_URL: 'https://hub.test',
        CLAUDE_MEM_CLOUD_SYNC_DEVICE_ID: DEVICE_ID,
      }
      : {}, {
      fetchImpl: (async () => { throw new Error('no network in this test'); }) as unknown as typeof fetch,
      settingsPath: join(tempDir, 'settings.json'),
    });
  }

  it('returns the configured id, the same one status() reports, and runs no SQL', () => {
    const sync = makeSync(true);
    const witness = watchMainThreadStatements({ maxSqlMs: 1000 });
    let id = '';
    let during: ReturnType<typeof witness.finish>;
    try {
      id = sync.localDeviceId();
    } finally { during = witness.finish(); }
    expect(id).toBe(DEVICE_ID);
    expect(during.total).toBe(0);
    expect(during.seen).toEqual([]);

    // EXECUTION: the same watch does see SQL when status() runs, so the zero above is not a dead recorder.
    const control = watchMainThreadStatements({ maxSqlMs: 1000 });
    let reported = '';
    let after: ReturnType<typeof control.finish>;
    try { reported = sync.status().deviceId; } finally { after = control.finish(); }
    expect(after.total).toBeGreaterThan(0);
    expect(reported).toBe(id);
  });

  it('returns an empty id when sync is not configured', () => {
    expect(makeSync(false).localDeviceId()).toBe('');
  });
});
