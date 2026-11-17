import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { projectReadKeys } from '../../src/services/sqlite/project-read-keys.js';
import {
  ContextStatementCache,
  queryObservationsMulti,
  querySummariesMulti,
} from '../../src/services/context/ObservationCompiler.js';
import { SUMMARY_LOOKAHEAD, type ContextConfig } from '../../src/services/context/types.js';

const config: ContextConfig = {
  totalObservationCount: 25,
  fullObservationCount: 0,
  sessionCount: 5,
  showReadTokens: false,
  showWorkTokens: false,
  showSavingsAmount: false,
  showSavingsPercent: false,
  observationTypes: new Set(['discovery']),
  observationConcepts: new Set(['how-it-works']),
  fullObservationField: 'narrative',
  showLastSummary: true,
  showLastMessage: false,
  mainAgentOnly: false,
};

const WORKTREE_COUNT = 140;
const PARENT = 'pwm-os';

function seed(store: SessionStore, project: string, title: string, createdAtEpoch: number): void {
  const memorySessionId = `mem-${title}`;
  const sessionDbId = store.createSDKSession(`content-${title}`, project, 'prompt', undefined, 'claude');
  store.ensureMemorySessionIdRegistered(sessionDbId, memorySessionId);
  store.storeObservation(memorySessionId, project, {
    type: 'discovery', title, subtitle: null, facts: [], narrative: 'n',
    concepts: ['how-it-works'], files_read: [], files_modified: [],
  }, 1, 0, createdAtEpoch);
  store.storeSummary(memorySessionId, project, {
    request: title, investigated: 'i', learned: 'l', completed: 'c', next_steps: 'n', notes: null,
  }, 1, 0, createdAtEpoch);
}

function referenceIds(db: Database, table: string, keys: string[], limit: number): number[] {
  const marks = keys.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id FROM ${table}
    WHERE project COLLATE NOCASE IN (${marks}) OR merged_into_project COLLATE NOCASE IN (${marks})
    ORDER BY created_at_epoch DESC LIMIT ?
  `).all(...keys, ...keys, limit) as Array<{ id: number }>;
  return rows.map(row => row.id);
}

describe('context statement cache', () => {
  let directory: string;
  let dbPath: string;
  let store: SessionStore;
  let keys: string[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'claude-mem-context-cache-'));
    dbPath = join(directory, 'claude-mem.db');
    store = new SessionStore(dbPath);
    seed(store, PARENT, 'parent-row', 1_000_000);
    for (let index = 0; index < WORKTREE_COUNT; index++) {
      seed(store, `${PARENT}/wt-${index}`, `worktree-${index}`, 1_000_010 + index * 10);
    }
    store.db.run(`UPDATE observations SET merged_into_project = '${PARENT}' WHERE project LIKE '${PARENT}/wt-%'`);
    store.db.run(`UPDATE session_summaries SET merged_into_project = '${PARENT}' WHERE project LIKE '${PARENT}/wt-%'`);
    keys = projectReadKeys(store.db, [PARENT]);
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads 141 merged keys', () => {
    expect(keys).toHaveLength(WORKTREE_COUNT + 1);
  });

  it('returns the same ids cached, uncached and by brute force', () => {
    const cache = new ContextStatementCache(store.db);
    for (const readKeys of [keys, [...keys, ...Array.from({ length: 159 }, (_, index) => `ghost-${index}`)]]) {
      const uncached = queryObservationsMulti({ db: store.db }, readKeys, config).map(row => row.id);
      const cached = queryObservationsMulti({ db: store.db, statements: cache }, readKeys, config).map(row => row.id);
      expect(cached).toEqual(uncached);
      expect(uncached).toEqual(referenceIds(store.db, 'observations', readKeys, config.totalObservationCount));

      const uncachedSummaries = querySummariesMulti({ db: store.db }, readKeys, config).map(row => row.id);
      const cachedSummaries = querySummariesMulti({ db: store.db, statements: cache }, readKeys, config).map(row => row.id);
      expect(cachedSummaries).toEqual(uncachedSummaries);
      expect(uncachedSummaries).toEqual(referenceIds(store.db, 'session_summaries', readKeys, config.sessionCount + SUMMARY_LOOKAHEAD));
    }
    cache.finalizeAll();
  });

  it('prepares once per shape across repeated calls and once more for a new key count', () => {
    const cache = new ContextStatementCache(store.db);
    const prepare = spyOn(store.db, 'prepare');
    const owner = { db: store.db, statements: cache };

    for (let call = 0; call < 3; call++) {
      queryObservationsMulti(owner, keys, config);
      querySummariesMulti(owner, keys, config);
    }
    expect(prepare).toHaveBeenCalledTimes(2);

    queryObservationsMulti(owner, keys.slice(1), config);
    querySummariesMulti(owner, keys.slice(1), config);
    expect(prepare).toHaveBeenCalledTimes(4);

    queryObservationsMulti(owner, keys, { ...config, mainAgentOnly: true });
    expect(prepare).toHaveBeenCalledTimes(5);
    expect(cache.size).toBe(5);

    prepare.mockRestore();
    cache.finalizeAll();
    expect(cache.size).toBe(0);
  });

  it('prepares and finalizes every call when no cache is given', () => {
    const prepare = spyOn(store.db, 'prepare');
    for (let call = 0; call < 3; call++) queryObservationsMulti({ db: store.db }, keys, config);
    expect(prepare).toHaveBeenCalledTimes(3);
    prepare.mockRestore();
  });

  it('evicts the least recently used statement and finalizes it', () => {
    const cache = new ContextStatementCache(store.db, 2);
    const first = cache.prepare('SELECT 1');
    const second = cache.prepare('SELECT 2');
    expect(cache.prepare('SELECT 1')).toBe(first);
    cache.prepare('SELECT 3');

    expect(cache.size).toBe(2);
    expect(second.toString()).toBe('');
    expect(first.toString()).not.toBe('');
    cache.finalizeAll();
    expect(first.toString()).toBe('');
  });

  it('shows a row committed by another connection on the next cached read and lets that writer checkpoint', () => {
    const reader = new Database(dbPath, { readonly: true, create: false });
    const cache = new ContextStatementCache(reader);
    const owner = { db: reader, statements: cache };
    const before = queryObservationsMulti(owner, keys, config).map(row => row.id);

    const writer = new SessionStore(dbPath);
    try {
      seed(writer, `${PARENT}/wt-0`, 'fresh-row', 9_000_000);
      const after = queryObservationsMulti(owner, keys, config);
      expect(after[0].title).toBe('fresh-row');
      expect(after.map(row => row.id)).not.toEqual(before);

      const checkpoint = writer.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
      expect(checkpoint.busy).toBe(0);
    } finally {
      writer.close();
      cache.finalizeAll();
      reader.close();
    }
  });
});

const repoRoot = process.cwd();
const connectionScript = `
  import { SessionStore } from './src/services/sqlite/SessionStore.ts';
  import { generateContext, closeContextReadConnection } from './src/services/context/ContextBuilder.ts';
  import { ModeManager } from './src/services/domain/ModeManager.ts';
  import { rmSync } from 'node:fs';
  ModeManager.getInstance().loadMode('code');
  const dbPath = process.env.CLAUDE_MEM_DATA_DIR + '/claude-mem.db';
  function write(title: string, epoch: number) {
    const store = new SessionStore(dbPath);
    const session = store.createSDKSession('content-' + title, 'cache-app', 'prompt');
    store.ensureMemorySessionIdRegistered(session, 'memory-' + title);
    store.storeObservation('memory-' + title, 'cache-app', {
      type: 'discovery', title, subtitle: null, facts: [], narrative: 'n',
      concepts: ['how-it-works'], files_read: [], files_modified: [],
    }, 1, 0, epoch);
    store.close();
  }
  const render = () => generateContext({ projects: ['cache-app'] });
  write('FIRST_RECORD', 1_700_000_000_000);
  const first = await render();
  write('SECOND_RECORD', 1_700_000_001_000);
  const second = await render();
  rmSync(dbPath + '-wal', { force: true });
  rmSync(dbPath + '-shm', { force: true });
  rmSync(dbPath);
  const missing = await render();
  write('THIRD_RECORD', 1_700_000_002_000);
  const recreated = await render();
  closeContextReadConnection();
  closeContextReadConnection();
  const afterClose = await render();
  console.log(JSON.stringify({ first, second, missing, recreated, afterClose }));
`;

describe('context read connection across renders', () => {
  it('sees new commits, survives the file being replaced, and reopens after close', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'claude-mem-context-conn-'));
    try {
      const result = Bun.spawnSync([process.execPath, '-e', connectionScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          CLAUDE_MEM_DATA_DIR: dataDir,
          CLAUDE_CONFIG_DIR: dataDir,
          CLAUDE_MEM_MODES_DIR: join(repoRoot, 'plugin', 'modes'),
        },
      });
      if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
      const out = JSON.parse(new TextDecoder().decode(result.stdout).trim().split('\n').at(-1)!);
      expect(out.first).toContain('FIRST_RECORD');
      expect(out.first).not.toContain('SECOND_RECORD');
      expect(out.second).toContain('FIRST_RECORD');
      expect(out.second).toContain('SECOND_RECORD');
      expect(out.missing).not.toContain('FIRST_RECORD');
      expect(out.recreated).toContain('THIRD_RECORD');
      expect(out.recreated).not.toContain('FIRST_RECORD');
      expect(out.afterClose).toContain('THIRD_RECORD');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
