import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { MAX_SUMMARY_ATTEMPTS, reopenLostToolUses } from '../../src/services/sqlite/tool-uses.js';
import type { DatabaseManager } from '../../src/services/worker/DatabaseManager.js';
import { SessionManager } from '../../src/services/worker/SessionManager.js';
import { logger } from '../../src/utils/logger.js';

/**
 * The summary ledger: a tool use stays owed in `tool_uses` until the observer
 * has answered it, so a worker that dies with work buffered loses none of it.
 * Each `SessionManager` below stands for one worker lifetime over the same
 * database.
 */
describe('summary ledger recovery', () => {
  let store: SessionStore;
  let spies: ReturnType<typeof spyOn>[] = [];

  beforeEach(() => {
    spies = ['info', 'debug', 'warn', 'error'].map(level =>
      spyOn(logger, level as 'info').mockImplementation(() => {}));
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    spies.forEach(spy => spy.mockRestore());
    store.close();
  });

  function workerLifetime(): SessionManager {
    const dbManager = {
      getSessionStore: () => store,
      getSessionById: (sessionDbId: number) => {
        const session = store.getSessionById(sessionDbId);
        if (!session) throw new Error(`Session ${sessionDbId} not found`);
        return session;
      },
    } as unknown as DatabaseManager;
    return new SessionManager(dbManager);
  }

  function newSession(name: string): number {
    return store.createSDKSession(`content-${name}`, 'project', 'prompt');
  }

  /** What the ingest path writes for a captured tool use. */
  function capture(sessionDbId: number, toolUseId: string, createdAtEpoch: number, summaryOwed: boolean | 'unset' = true): void {
    store.upsertToolUse({
      toolUseId,
      contentSessionId: store.getSessionById(sessionDbId)!.content_session_id,
      sessionDbId,
      project: 'project',
      toolName: 'Read',
      toolInput: `{"file":"${toolUseId}"}`,
      toolResponse: '{"ok":true}',
      createdAtEpoch,
      ...(summaryOwed === 'unset' ? {} : { summaryOwed }),
    });
  }

  function state(toolUseId: string): { summary_state: string | null; summary_attempts: number } {
    return store.db
      .prepare('SELECT summary_state, summary_attempts FROM tool_uses WHERE tool_use_id = ?')
      .get(toolUseId) as { summary_state: string | null; summary_attempts: number };
  }

  /** Claim everything the session has buffered, in the order a generator would get it. */
  function claimAll(manager: SessionManager, sessionDbId: number): Array<{ toolUseId?: string; id: number }> {
    const claimed: Array<{ toolUseId?: string; id: number }> = [];
    for (;;) {
      const next = manager.getMessageBuffer().claimNextMatching(sessionDbId, () => true);
      if (!next) return claimed;
      claimed.push({ toolUseId: next.toolUseId, id: next._persistentId });
    }
  }

  it('records at capture whether a tool use is owed a summary pass', () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 'owed', 1, true);
    capture(sessionDbId, 'not-queued', 2, false);
    capture(sessionDbId, 'unknown', 3, 'unset');

    expect(state('owed').summary_state).toBe('pending');
    expect(state('not-queued').summary_state).toBe('done');
    expect(state('unknown').summary_state).toBeNull();
    expect(store.countOwedToolUseSummaries()).toBe(1);
  });

  it('a replayed capture does not reopen a settled tool use', () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 't1', 1);
    store.settleToolUseSummaries({ sessionDbId, toolUseIds: ['t1'], state: 'done' });

    capture(sessionDbId, 't1', 1);

    expect(state('t1').summary_state).toBe('done');
  });

  it('a new worker loads what the dead one left owed, ahead of new work', () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 't1', 1);
    capture(sessionDbId, 't2', 2);

    const restarted = workerLifetime();
    capture(sessionDbId, 't3', 3);
    restarted.queueObservation(sessionDbId, {
      tool_name: 'Read', tool_input: '{}', tool_response: '{}', prompt_number: 1, toolUseId: 't3',
    });

    expect(claimAll(restarted, sessionDbId).map(m => m.toolUseId)).toEqual(['t1', 't2', 't3']);
    // The arriving tool use was queued by its own capture, not replayed.
    expect(state('t3').summary_attempts).toBe(0);
    expect(state('t1').summary_attempts).toBe(1);
  });

  it('a confirmed tool use is settled and never loaded again', async () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 't1', 1);
    capture(sessionDbId, 't2', 2);

    const first = workerLifetime();
    expect(first.loadOwedToolUses(sessionDbId)).toBe(2);
    const [head] = claimAll(first, sessionDbId);
    first.getMessageBuffer().confirm(head.id);

    expect(state('t1').summary_state).toBe('done');
    expect(state('t2').summary_state).toBe('pending');

    const second = workerLifetime();
    expect(second.loadOwedToolUses(sessionDbId)).toBe(1);
    expect(claimAll(second, sessionDbId).map(m => m.toolUseId)).toEqual(['t2']);
  });

  it('does not load a tool use the same worker already holds', () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 't1', 1);
    const manager = workerLifetime();

    expect(manager.loadOwedToolUses(sessionDbId)).toBe(1);
    expect(manager.loadOwedToolUses(sessionDbId)).toBe(0);
    expect(manager.getTotalQueueDepth()).toBe(1);
    expect(state('t1').summary_attempts).toBe(1);
  });

  it('settles the batch in the transaction that stores its observations', () => {
    const sessionDbId = newSession('a');
    store.updateMemorySessionId(sessionDbId, 'mem-a');
    capture(sessionDbId, 't1', 1);
    capture(sessionDbId, 't2', 2);
    const observation = {
      type: 'discovery', title: 'A', subtitle: null, facts: [], narrative: 'a',
      concepts: [], files_read: [], files_modified: [],
    };

    // The memory session is unknown, so the store fails its foreign key and
    // the whole transaction, settle included, rolls back.
    expect(() => store.storeObservations('mem-missing', 'project', [observation], null, 1, 0, 10, undefined, {
      settleToolUses: { sessionDbId, toolUseIds: ['t1', 't2'] },
    })).toThrow();
    expect(state('t1').summary_state).toBe('pending');

    store.storeObservations('mem-a', 'project', [observation], null, 1, 0, 10, undefined, {
      settleToolUses: { sessionDbId, toolUseIds: ['t1'] },
    });
    expect(state('t1').summary_state).toBe('done');
    expect(state('t2').summary_state).toBe('pending');
  });

  it('parks a tool use after the attempt limit instead of replaying it forever', () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 'poison', 1);

    for (let lifetime = 0; lifetime < MAX_SUMMARY_ATTEMPTS; lifetime++) {
      expect(workerLifetime().loadOwedToolUses(sessionDbId)).toBe(1);
    }
    expect(state('poison').summary_state).toBe('pending');

    expect(workerLifetime().loadOwedToolUses(sessionDbId)).toBe(0);
    expect(state('poison').summary_state).toBe('parked');
    expect(store.countOwedToolUseSummaries()).toBe(0);
  });

  it('a batch parked by the send budget leaves the ledger', () => {
    const sessionDbId = newSession('a');
    capture(sessionDbId, 't1', 1);
    const manager = workerLifetime();
    manager.loadOwedToolUses(sessionDbId);
    const [head] = claimAll(manager, sessionDbId);

    manager.getMessageBuffer().park(sessionDbId, [head.id], 'attempt-1');

    expect(state('t1').summary_state).toBe('parked');
  });

  describe('reopening what a worker without the ledger lost', () => {
    /** A row from before the ledger: no state, linked or not. */
    function legacy(sessionDbId: number, toolUseId: string, createdAtEpoch: number, linked = false, toolName = 'Read'): void {
      capture(sessionDbId, toolUseId, createdAtEpoch, 'unset');
      store.db.prepare('UPDATE tool_uses SET tool_name = ?, observation_id = ? WHERE tool_use_id = ?')
        .run(toolName, linked ? 1 : null, toolUseId);
    }

    it('reopens what was captured after the last linked tool use of that lifetime', () => {
      const sessionDbId = newSession('a');
      legacy(sessionDbId, 'skipped-by-observer', 100);
      legacy(sessionDbId, 'linked', 110, true);
      legacy(sessionDbId, 'lost-1', 120);
      legacy(sessionDbId, 'lost-2', 130);
      // The next lifetime captured and linked newer work; it is outside the window.
      legacy(sessionDbId, 'next-lifetime', 210, true);

      expect(reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: true }))
        .toEqual({ reopened: 2, sessions: 1 });
      expect(state('lost-1').summary_state).toBe('pending');
      expect(state('lost-2').summary_state).toBe('pending');
      expect(state('skipped-by-observer').summary_state).toBeNull();
      expect(state('linked').summary_state).toBeNull();
      expect(state('next-lifetime').summary_state).toBeNull();
    });

    it('reopens every tool use of a session the lifetime never reached', () => {
      const sessionDbId = newSession('a');
      legacy(sessionDbId, 'lost-1', 120);
      legacy(sessionDbId, 'lost-2', 130);

      expect(reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: true }).reopened).toBe(2);
    });

    it('reports without changing anything unless told to apply', () => {
      const sessionDbId = newSession('a');
      legacy(sessionDbId, 'lost', 120);

      expect(reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: false }))
        .toEqual({ reopened: 1, sessions: 1 });
      expect(state('lost').summary_state).toBeNull();
    });

    it('reopens nothing on a second run, and never a row the ledger already classified', () => {
      const sessionDbId = newSession('a');
      legacy(sessionDbId, 'lost', 120);
      capture(sessionDbId, 'settled', 130);
      store.settleToolUseSummaries({ sessionDbId, toolUseIds: ['settled'], state: 'done' });
      reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: true });

      expect(reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: true }).reopened).toBe(0);
      expect(state('settled').summary_state).toBe('done');
    });

    it('leaves a saved-note receipt alone: the worker never queued it', () => {
      const sessionDbId = newSession('a');
      legacy(sessionDbId, 'note', 120, false, 'save_memory');

      expect(reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: true }).reopened).toBe(0);
    });

    it('a reopened tool use is replayed by the next backlog admission', () => {
      const sessionDbId = newSession('a');
      legacy(sessionDbId, 'lost', 120);
      reopenLostToolUses(store.db, { sinceEpoch: 100, beforeEpoch: 200, apply: true });

      const manager = workerLifetime();
      expect(manager.admitOwedSessions(1)).toEqual([sessionDbId]);
      expect(claimAll(manager, sessionDbId).map(m => m.toolUseId)).toEqual(['lost']);
    });
  });

  describe('backlog admission', () => {
    it('admits the session with the oldest owed tool use, and no more than the limit', () => {
      const newer = newSession('newer');
      const older = newSession('older');
      capture(newer, 'n1', 200);
      capture(older, 'o1', 100);
      capture(older, 'o2', 300);
      const manager = workerLifetime();

      expect(manager.admitOwedSessions(1)).toEqual([older]);
      expect(manager.getTotalQueueDepth()).toBe(2);
      // The limit is held while the admitted session still has unsent work.
      expect(manager.admitOwedSessions(1)).toEqual([]);
      expect(state('n1').summary_attempts).toBe(0);
    });

    it('admits the next session once the admitted one is answered', () => {
      const first = newSession('first');
      const second = newSession('second');
      capture(first, 'f1', 100);
      capture(second, 's1', 200);
      const manager = workerLifetime();
      manager.admitOwedSessions(1);

      for (const message of claimAll(manager, first)) manager.getMessageBuffer().confirm(message.id);

      expect(manager.admitOwedSessions(1)).toEqual([second]);
    });

    it('leaves a session alone that live capture already brought back', () => {
      const live = newSession('live');
      capture(live, 'l1', 100);
      const manager = workerLifetime();
      manager.queueSummarize(live, 'done');
      expect(manager.getTotalQueueDepth()).toBe(2);

      expect(manager.admitOwedSessions(1)).toEqual([]);
      expect(state('l1').summary_attempts).toBe(1);
    });

    it('admits nothing when the limit is zero', () => {
      capture(newSession('a'), 't1', 1);

      expect(workerLifetime().admitOwedSessions(0)).toEqual([]);
      expect(state('t1').summary_state).toBe('pending');
    });

    it('parks the owed tool uses of a session that no longer exists', () => {
      const sessionDbId = newSession('gone');
      capture(sessionDbId, 'g1', 1);
      store.db.prepare('DELETE FROM sdk_sessions WHERE id = ?').run(sessionDbId);

      expect(workerLifetime().admitOwedSessions(1)).toEqual([]);
      expect(state('g1').summary_state).toBe('parked');
    });
  });
});
