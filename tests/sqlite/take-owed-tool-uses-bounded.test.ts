import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';

import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { MAX_SUMMARY_ATTEMPTS, takeOwedToolUses, type ToolUseRow } from '../../src/services/sqlite/tool-uses.js';

const NOW = 1_800_000_000_000;

function seedOwedRows(
  db: Database,
  session: { sessionDbId: number; contentSessionId: string },
  count: number,
  payload: string,
): void {
  db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO tool_uses (
      tool_use_id, content_session_id, session_db_id, project, tool_name,
      tool_response, created_at, created_at_epoch, summary_state, summary_attempts
    )
    SELECT 't' || i, ?, ?, 'project', 'Read', ?, '2026-01-01T00:00:00.000Z', i, 'pending', 0 FROM n
  `).run(count, session.contentSessionId, session.sessionDbId, payload);
}

function toolUseIds(...numbers: number[]): Set<string> {
  return new Set(numbers.map(number => `t${number}`));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function rowState(db: Database): unknown[] {
  return db.prepare('SELECT id, summary_state, summary_attempts, summary_state_epoch FROM tool_uses ORDER BY id').all();
}

function legacyTakeOwedToolUses(
  db: Database,
  params: { sessionDbId: number; heldToolUseIds: ReadonlySet<string>; limit?: number; nowEpoch?: number },
): { rows: ToolUseRow[]; parked: number } {
  const nowEpoch = params.nowEpoch ?? Date.now();
  return db.transaction(() => {
    const owed = (db.prepare(`
      SELECT * FROM tool_uses
      WHERE session_db_id = ? AND summary_state = 'pending'
      ORDER BY id ASC
    `).all(params.sessionDbId) as Array<ToolUseRow & { summary_attempts: number }>)
      .filter(row => !params.heldToolUseIds.has(row.tool_use_id));
    const park = db.prepare(`UPDATE tool_uses SET summary_state = 'parked', summary_state_epoch = ? WHERE id = ?`);
    const attempt = db.prepare('UPDATE tool_uses SET summary_attempts = summary_attempts + 1 WHERE id = ?');
    const rows: ToolUseRow[] = [];
    let parked = 0;
    for (const row of owed) {
      if (params.limit !== undefined && rows.length >= params.limit) break;
      if (row.summary_attempts >= MAX_SUMMARY_ATTEMPTS) {
        park.run(nowEpoch, row.id);
        parked++;
        continue;
      }
      attempt.run(row.id);
      rows.push(row);
    }
    return { rows, parked };
  }).immediate();
}

describe('takeOwedToolUses claims a bounded slice', () => {
  let store: SessionStore;
  let session: { sessionDbId: number; contentSessionId: string };

  beforeEach(() => {
    store = new SessionStore(':memory:');
    const sessionDbId = store.createSDKSession('content-owed', 'project', 'prompt');
    session = { sessionDbId, contentSessionId: 'content-owed' };
  });

  afterEach(() => store.close());

  function setAttempts(ids: number[], attempts: number): void {
    const update = store.db.prepare('UPDATE tool_uses SET summary_attempts = ? WHERE id = ?');
    for (const id of ids) update.run(attempts, id);
  }

  function take(limit: number | undefined, held: Set<string> = new Set()) {
    return takeOwedToolUses(store.db, { sessionDbId: session.sessionDbId, heldToolUseIds: held, limit, nowEpoch: NOW });
  }

  it('returns limit rows from 10,000 owed rows and reads no payload of a row it does not return', () => {
    seedOwedRows(store.db, session, 10_000, 'x'.repeat(60 * 1024));

    const preparedSql: string[] = [];
    const rowsRead: Array<Record<string, unknown>> = [];
    const prepare = store.db.prepare.bind(store.db);
    (store.db as { prepare: unknown }).prepare = (sql: string, ...rest: unknown[]) => {
      preparedSql.push(sql);
      const statement = (prepare as (...args: unknown[]) => Record<string, (...args: unknown[]) => unknown>)(sql, ...rest);
      for (const method of ['all', 'get'] as const) {
        const original = statement[method].bind(statement);
        statement[method] = (...args: unknown[]) => {
          const result = original(...args);
          if (Array.isArray(result)) rowsRead.push(...(result as Array<Record<string, unknown>>));
          else if (result) rowsRead.push(result as Record<string, unknown>);
          return result;
        };
      }
      return statement;
    };

    const { rows, parked } = take(32);

    expect(parked).toBe(0);
    expect(rows.map(row => row.id)).toEqual(range(1, 32));
    expect(rows.every(row => row.tool_response?.length === 60 * 1024)).toBe(true);

    const returnedIds = new Set(rows.map(row => row.id));
    const withPayload = rowsRead.filter(row => 'tool_response' in row || 'tool_input' in row);
    expect(withPayload).toHaveLength(32);
    expect(withPayload.every(row => returnedIds.has(row.id as number))).toBe(true);

    const candidateSql = preparedSql.find(sql => /SELECT id, tool_use_id, summary_attempts/.test(sql));
    expect(candidateSql).toBeDefined();
    expect(candidateSql).not.toMatch(/tool_response|tool_input|\*/);
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN ${candidateSql}`)
      .all(session.sessionDbId, 0, 32) as Array<{ detail: string }>;
    expect(plan.map(step => step.detail).join('\n')).toContain('idx_tool_uses_summary_owed');
  }, 60_000);

  it('lets held ids consume the limit: skips them without counting, attempting or parking', () => {
    seedOwedRows(store.db, session, 200, 'p');

    const { rows, parked } = take(32, toolUseIds(...range(1, 40)));

    expect(parked).toBe(0);
    expect(rows.map(row => row.id)).toEqual(range(41, 72));
    const state = store.db.prepare('SELECT id, summary_state, summary_attempts FROM tool_uses WHERE id <= 40').all() as Array<{
      summary_state: string; summary_attempts: number;
    }>;
    expect(state.every(row => row.summary_state === 'pending' && row.summary_attempts === 0)).toBe(true);
  });

  it('ignores held ids that are not pending', () => {
    seedOwedRows(store.db, session, 10, 'p');

    const { rows } = take(3, new Set(['unknown-1', 'unknown-2', 'unknown-3', 't1']));

    expect(rows.map(row => row.id)).toEqual([2, 3, 4]);
  });

  it('pages past a head of rows that are all held or capped', () => {
    seedOwedRows(store.db, session, 400, 'p');
    setAttempts(range(1, 50), MAX_SUMMARY_ATTEMPTS);

    const { rows, parked } = take(32);

    expect(parked).toBe(50);
    expect(rows.map(row => row.id)).toEqual(range(51, 82));
    const capped = store.db.prepare(`SELECT COUNT(*) AS n FROM tool_uses WHERE summary_state = 'parked'`).get() as { n: number };
    expect(capped.n).toBe(50);
  });

  it('leaves a capped row that follows the last chosen row pending', () => {
    seedOwedRows(store.db, session, 10, 'p');
    setAttempts([4], MAX_SUMMARY_ATTEMPTS);

    const { rows, parked } = take(3);

    expect(rows.map(row => row.id)).toEqual([1, 2, 3]);
    expect(parked).toBe(0);
    const row = store.db.prepare('SELECT summary_state, summary_attempts FROM tool_uses WHERE id = 4').get() as {
      summary_state: string; summary_attempts: number;
    };
    expect(row).toEqual({ summary_state: 'pending', summary_attempts: MAX_SUMMARY_ATTEMPTS });
  });

  it('returns every unheld row in id order when no limit is given, across several scan pages', () => {
    seedOwedRows(store.db, session, 1_300, 'p');

    const { rows } = take(undefined, toolUseIds(5, 6));

    expect(rows).toHaveLength(1_298);
    expect(rows.map(row => row.id)).toEqual(range(1, 1_300).filter(id => id !== 5 && id !== 6));
  });

  it('writes nothing for a limit of 0 or less', () => {
    seedOwedRows(store.db, session, 5, 'p');
    setAttempts([1], MAX_SUMMARY_ATTEMPTS);
    const before = rowState(store.db);

    expect(take(0)).toEqual({ rows: [], parked: 0 });
    expect(take(-3)).toEqual({ rows: [], parked: 0 });
    expect(rowState(store.db)).toEqual(before);
  });

  it('returns rows as they were before this claim counted its attempt', () => {
    seedOwedRows(store.db, session, 3, 'p');
    setAttempts([2], 2);

    const { rows } = take(3);

    expect(rows.map(row => (row as ToolUseRow & { summary_attempts: number }).summary_attempts)).toEqual([0, 2, 0]);
    const after = store.db.prepare('SELECT summary_attempts FROM tool_uses ORDER BY id').all();
    expect(after).toEqual([{ summary_attempts: 1 }, { summary_attempts: 3 }, { summary_attempts: 1 }]);
  });

  describe('against the previous select-everything implementation', () => {
    function build(): { db: Database; sessionDbId: number; close: () => void } {
      const fresh = new SessionStore(':memory:');
      const sessionDbId = fresh.createSDKSession('content-diff', 'project', 'prompt');
      seedOwedRows(fresh.db, { sessionDbId, contentSessionId: 'content-diff' }, 300, 'small');
      const cap = fresh.db.prepare('UPDATE tool_uses SET summary_attempts = ? WHERE id = ?');
      for (let id = 1; id <= 300; id++) {
        if (id % 7 === 0) cap.run(MAX_SUMMARY_ATTEMPTS, id);
        else if (id % 11 === 0) cap.run(MAX_SUMMARY_ATTEMPTS - 1, id);
      }
      for (const id of [20, 21, 22, 23]) fresh.db.prepare(`UPDATE tool_uses SET summary_state = 'done' WHERE id = ?`).run(id);
      return { db: fresh.db, sessionDbId, close: () => fresh.close() };
    }

    const held = new Set([...range(1, 300).filter(id => id % 5 === 0).map(id => `t${id}`), 'ghost-1']);

    for (const limit of [undefined, 0, 1, 7, 32, 500]) {
      it(`matches rows, parked count and per-row state for limit ${limit}`, () => {
        const legacy = build();
        const current = build();
        try {
          const expected = legacyTakeOwedToolUses(legacy.db, { sessionDbId: legacy.sessionDbId, heldToolUseIds: held, limit, nowEpoch: NOW });
          const actual = takeOwedToolUses(current.db, { sessionDbId: current.sessionDbId, heldToolUseIds: held, limit, nowEpoch: NOW });
          expect(actual).toEqual(expected);
          expect(rowState(current.db)).toEqual(rowState(legacy.db));
        } finally {
          legacy.close();
          current.close();
        }
      });
    }
  });
});
