import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { ContextReadWorkerClient } from '../../src/services/context/ContextReadWorkerClient.js';
import { workerWorkViewReader } from '../../src/services/work-view/work-view-reader.js';
import type { WorkViewReadInput } from '../../src/services/work-view/work-view-sources.js';

let directory: string;
let databasePath: string;
let store: SessionStore;
let client: ContextReadWorkerClient;

const input = (overrides: Partial<WorkViewReadInput> = {}): WorkViewReadInput => ({
  databasePath, ledgerDir: null, localDeviceId: '', pollIntervalMs: 1000, activityRefreshMs: 60_000, ...overrides,
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'work-view-thread-'));
  databasePath = join(directory, 'source.db');
  store = new SessionStore(databasePath);
  store.appendWorkStateEntry({ project: 'home', listName: 'example-work', fields: { task: 'Build', status: 'done', request_id: 'r1', human_request: 'Build a viewer' } });
  client = new ContextReadWorkerClient();
});

afterEach(async () => {
  await client.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('work view reads on the context read thread', () => {
  it('returns the built view as JSON and keeps its caches between reads', async () => {
    const first = JSON.parse(await client.workViewRead(input()));
    expect(first.source.connected).toBe(true);
    expect(first.humanRequests[0].original.text).toBe('Build a viewer');
    (store as unknown as { db: Database }).db.prepare(`INSERT INTO tool_uses (tool_use_id, content_session_id, project, tool_name, created_at, created_at_epoch)
      VALUES ('tu-1', 's1', 'p', 'Read', ?, ?)`).run(new Date().toISOString(), Date.now());
    const second = JSON.parse(await client.workViewRead(input()));
    expect(second.revision).toBe(first.revision);
  });

  it('reads the saved rules without building the view, and reads a refresh needs result', async () => {
    const rules = await client.workViewRules(input());
    expect(rules).toEqual({ connected: true, rules: [] });
    const needs = await client.workViewRefreshNeeds({ ledgerDir: join(directory, 'ledger'), databasePath, localDeviceId: '', now: Date.now() });
    expect(typeof needs.needed).toBe('boolean');
  });

  it('answers a missing database as unavailable and never creates it', async () => {
    const missing = join(directory, 'nested', 'missing.db');
    mkdirSync(join(directory, 'nested'));
    const view = JSON.parse(await client.workViewRead(input({ databasePath: missing })));
    expect(view.source).toMatchObject({ connected: false, error: 'Local work-state database is unavailable.' });
    expect(existsSync(missing)).toBe(false);
  });

  it('the reader adapter parses the view, and a closed reader rejects', async () => {
    const reader = workerWorkViewReader(client);
    expect((await reader.read(input())).source.connected).toBe(true);
    await reader.close();
    await expect(reader.read(input())).rejects.toThrow('Context reader closed');
  });
});
