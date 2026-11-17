import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Database } from 'bun:sqlite';

import { openSqliteDatabase } from '../../../src/services/sqlite/open-database.js';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { configureUnscopedSqlTurns, type SlowRequestContext } from '../../../src/services/sqlite/sql-scope.js';
import { ChromaSync } from '../../../src/services/sync/ChromaSync.js';
import { logger } from '../../../src/utils/logger.js';

/** A statement long enough to register on the clock, run through an instrumented connection. */
function runSlowStatement(db: Database): void {
  db.query('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 30000) SELECT count(*) FROM c').get();
}

describe('ChromaSync work runs inside a SQL scope', () => {
  let db: Database;
  let slowRequests: SlowRequestContext[];
  let previousThreshold: string | undefined;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    previousThreshold = process.env.CLAUDE_MEM_SLOW_REQUEST_MS;
    // Any measurable SQL time passes this, so the scope warns exactly when it wraps the work.
    process.env.CLAUDE_MEM_SLOW_REQUEST_MS = '0.000001';
    // A bucket left by an earlier test file in this process would carry its own threshold.
    configureUnscopedSqlTurns();
    db = openSqliteDatabase(':memory:');
    slowRequests = [];
    warnSpy = spyOn(logger, 'warn').mockImplementation(((component: string, message: string, context?: unknown) => {
      if (component === 'DB' && message.startsWith('SLOW_REQUEST')) slowRequests.push(context as SlowRequestContext);
    }) as typeof logger.warn);
  });

  afterEach(() => {
    configureUnscopedSqlTurns();
    warnSpy.mockRestore();
    db.close();
    if (previousThreshold === undefined) delete process.env.CLAUDE_MEM_SLOW_REQUEST_MS;
    else process.env.CLAUDE_MEM_SLOW_REQUEST_MS = previousThreshold;
  });

  const scopes = (): string[] => slowRequests.map(context => context.scope).filter(scope => scope.startsWith('chroma:'));

  it('syncObservation: SQL run while loading the current row is attributed to chroma:syncObservation', async () => {
    const chroma = new ChromaSync('scope-adoption-observation');
    await chroma.syncObservation(
      1, 'memory-session', 'scope-adoption-observation',
      { type: 'discovery', title: 't', subtitle: null, facts: [], narrative: 'n', concepts: [], files_read: [], files_modified: [] },
      1, Date.now(), undefined, false,
      () => { runSlowStatement(db); return undefined; },
    );
    expect(scopes()).toEqual(['chroma:syncObservation']);
    expect(slowRequests[0].statements).toBeGreaterThan(0);
  });

  it('syncSummary: attributed to chroma:syncSummary', async () => {
    const chroma = new ChromaSync('scope-adoption-summary');
    await chroma.syncSummary(
      2, 'memory-session', 'scope-adoption-summary',
      { request: 'r', investigated: null, learned: 'l', completed: null, next_steps: null, notes: null },
      1, Date.now(), undefined, false,
      () => { runSlowStatement(db); return undefined; },
    );
    expect(scopes()).toEqual(['chroma:syncSummary']);
  });

  it('syncUserPrompt: attributed to chroma:syncUserPrompt', async () => {
    const chroma = new ChromaSync('scope-adoption-prompt');
    await chroma.syncUserPrompt(
      3, 'memory-session', 'scope-adoption-prompt', 'prompt text', 1, Date.now(), undefined,
      () => { runSlowStatement(db); return undefined; },
    );
    expect(scopes()).toEqual(['chroma:syncUserPrompt']);
  });

  it('ensureBackfilled: attributed to chroma:ensureBackfilled, and the scope ends when the backfill rejects', async () => {
    const chroma = new ChromaSync('scope-adoption-backfill');
    chroma.ensureCollectionExists = async () => {
      runSlowStatement(db);
      throw new Error('collection unavailable');
    };
    await expect(chroma.ensureBackfilled('scope-adoption-backfill', {} as SessionStore)).rejects.toThrow('collection unavailable');
    expect(scopes()).toEqual(['chroma:ensureBackfilled']);
  });

  it('backfillAllProjects: its project enumeration is attributed to chroma:backfillAllProjects', async () => {
    const store = new SessionStore(':memory:');
    try {
      expect(await ChromaSync.backfillAllProjects(store)).toBe(true);
    } finally {
      store.close();
    }
    expect(scopes()).toEqual(['chroma:backfillAllProjects']);
    expect(slowRequests[0].statements).toBeGreaterThan(0);
  });

  it('a statement run with no ChromaSync scope is not attributed to any chroma scope', async () => {
    runSlowStatement(db);
    await new Promise(resolve => setImmediate(resolve));
    expect(scopes()).toEqual([]);
    expect(slowRequests.map(context => context.scope)).toEqual(['unscoped-turn']);
  });
});
