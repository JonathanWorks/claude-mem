import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { LATEST_SCHEMA_VERSION } from '../../src/services/sqlite/connection.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { readAgentRecords } from '../../src/services/work-view/agent-view.mjs';
import { distinctToolNames, likeMatcher, readProductRecords } from '../../src/services/work-view/work-product.mjs';

// The statements the work view ran before this change, kept verbatim so the plans before and after are printed side by side
// and so the new statements can be compared with them row for row.
const OLD_PUBLISHING_SQL = `SELECT id, session_db_id, prompt_number, tool_name, tool_input, tool_response, created_at_epoch FROM tool_uses
    WHERE created_at_epoch >= ? AND (tool_name IN ('Artifact', 'mcp__claude_ai_Notion__notion-create-pages', 'mcp__claude_ai_Claude_Docs__batch', 'mcp__claude_ai_Claude_Docs__create')
      OR tool_name LIKE '%chatgpt_space__create_page' OR tool_name LIKE '%sites__save_version_and_deploy%'
      OR (tool_name = 'Bash' AND tool_input LIKE '%gh pr create%'))
    ORDER BY id DESC LIMIT ?`;
const OLD_RECENT_ASKS_SQL = `SELECT id FROM sdk_sessions WHERE id IN (
    SELECT session_db_id FROM user_prompts WHERE created_at_epoch >= ? GROUP BY session_db_id ORDER BY MAX(created_at_epoch) DESC LIMIT ?)`;

interface Issued { sql: string; params: unknown[] }

let store: SessionStore;
let db: Database;

const plan = (sql: string, params: unknown[]): string[] =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map(row => row.detail);

/** The statements the work view issues now, as the code builds them: nothing here is retyped from the source. */
function productStatements(sinceEpoch: number): Issued[] {
  const issued: Issued[] = [];
  readProductRecords((sql: string, params: unknown[]) => { issued.push({ sql, params }); return db.prepare(sql).all(...params) as never[]; }, sinceEpoch);
  return issued;
}

function recentAsksStatement(now: number): Issued {
  const issued: Issued[] = [];
  const recording = new Proxy(db, {
    get: (target, key) => key === 'prepare'
      ? (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get: (inner, method) => method === 'all'
            ? (...params: unknown[]) => { issued.push({ sql, params }); return inner.all(...params as never[]); }
            : (inner as unknown as Record<string | symbol, unknown>)[method],
        });
      }
      : (target as unknown as Record<string | symbol, unknown>)[key],
  });
  readAgentRecords(recording, { workState: undefined, now });
  const found = issued.find(entry => entry.sql.includes('FROM user_prompts WHERE created_at_epoch >= ?'));
  if (!found) throw new Error('readAgentRecords no longer asks for recent sessions by a ranged user_prompts statement');
  return found;
}

/** Rows shaped like a real database: many tool names, few publishing calls, a spread of times, and planner statistics. */
function seedRepresentativeRows(analyze = true): void {
  const names = ['Read', 'Edit', 'Bash', 'Grep', 'Write', 'Artifact', 'mcp__x__chatgpt_space__create_page'];
  const toolUse = db.prepare(`INSERT INTO tool_uses (id, tool_use_id, content_session_id, project, tool_name, tool_input, tool_response, created_at, created_at_epoch)
    VALUES (?, ?, 's1', 'p', ?, ?, '{}', 'x', ?)`);
  for (let id = 1; id <= 3000; id++) toolUse.run(id, `tu-${id}`, names[id % names.length], id % 5 ? '{}' : '{"command":"git commit -m x"}', 1000 + id);
  for (let session = 1; session <= 40; session++) {
    db.prepare(`INSERT INTO sdk_sessions (id, content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, 'p', 'x', 1000, 'active')`).run(session, `c${session}`, `m${session}`);
  }
  const prompt = db.prepare(`INSERT INTO user_prompts (id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch, session_db_id)
    VALUES (?, ?, ?, 'ask', 'x', ?, ?)`);
  for (let id = 1; id <= 3000; id++) prompt.run(id, `c${(id % 40) + 1}`, id, 1000 + id, (id % 40) + 1);
  if (analyze) db.exec('ANALYZE');
}

beforeEach(() => {
  store = new SessionStore(':memory:');
  db = (store as unknown as { db: Database }).db;
});

afterEach(() => {
  store.close();
});

describe('work view query plans', () => {
  it('adds idx_tool_uses_name_created without a schema version, so an older worker still opens the database', () => {
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_tool_uses_name_created'").get() as { sql: string } | null;
    expect(index?.sql).toContain('tool_uses(tool_name, created_at_epoch)');
    expect(LATEST_SCHEMA_VERSION).toBe(68);
    const newest = db.prepare('SELECT MAX(version) AS version FROM schema_versions').get() as { version: number };
    expect(newest.version).toBe(68);
    expect(db.prepare('SELECT 1 FROM schema_versions WHERE version = 69').get()).toBeNull();
  });

  for (const analyzed of [false, true]) {
    it(`publishing calls (${analyzed ? 'with' : 'without'} ANALYZE): the old OR statement scans tool_uses, the statements the code issues search the composite index`, () => {
      seedRepresentativeRows(analyzed);
      const before = plan(OLD_PUBLISHING_SQL, [2900, 2000]);
      const issued = productStatements(2900);
      const byName = issued.find(entry => entry.sql.includes('tool_name IN ('));
      const pullRequests = issued.find(entry => entry.sql.includes("tool_input LIKE '%gh pr create%' ORDER BY id DESC"));
      const names = issued.filter(entry => entry.sql.includes('WHERE tool_name > ?'));
      const git = issued.find(entry => entry.sql.includes("tool_input LIKE '%git%'"));
      if (!byName || !pullRequests || !git || !names.length) throw new Error(`readProductRecords no longer issues the statements this test plans: ${issued.map(entry => entry.sql.slice(0, 60))}`);
      const plans = { byName: plan(byName.sql, byName.params), pullRequests: plan(pullRequests.sql, pullRequests.params), git: plan(git.sql, git.params), names: plan(names[0].sql, names[0].params) };
      console.log('PLAN publishing BEFORE', before, '\nPLAN publishing AFTER', plans);
      expect(before.some(line => /^SCAN tool_uses/.test(line))).toBe(true);
      expect(plans.byName.join('\n')).toContain('SEARCH tool_uses USING INDEX idx_tool_uses_name_created (tool_name=? AND created_at_epoch>?)');
      expect(plans.pullRequests.join('\n')).toContain('SEARCH tool_uses USING INDEX idx_tool_uses_name_created (tool_name=? AND created_at_epoch>?)');
      expect(plans.git.join('\n')).toMatch(/SEARCH tool_uses USING INDEX idx_tool_uses_(tool_name|name_created)/);
      expect(plans.names.join('\n')).toMatch(/SEARCH tool_uses USING COVERING INDEX idx_tool_uses_(tool_name|name_created)/);
      // Every statement against tool_uses, whatever it is, seeks an index.
      for (const entry of issued.filter(statement => /FROM tool_uses/.test(statement.sql))) {
        for (const line of plan(entry.sql, entry.params)) expect(line).not.toMatch(/^SCAN tool_uses/);
      }
    });
  }

  it('recent asks: the old GROUP BY scans user_prompts by session, the statement the code issues ranges over created_at_epoch', () => {
    seedRepresentativeRows();
    const issued = recentAsksStatement(3000);
    const before = plan(OLD_RECENT_ASKS_SQL, issued.params);
    const after = plan(issued.sql, issued.params);
    console.log('PLAN recent asks BEFORE', before, '\nPLAN recent asks AFTER', after);
    expect(issued.sql).toContain('GROUP BY +session_db_id');
    expect(before.join('\n')).toContain('SCAN user_prompts USING INDEX idx_user_prompts_session');
    expect(after.join('\n')).toContain('SEARCH user_prompts USING INDEX idx_user_prompts_created (created_at_epoch>?)');
    expect(after.join('\n')).not.toContain('SCAN user_prompts');
  });

  it('readAgentRecords asks for recent sessions with the ranged statement', () => {
    const statements: string[] = [];
    const spy = new Proxy(db, {
      get: (target, key) => key === 'prepare'
        ? (sql: string) => { statements.push(sql); return target.prepare(sql); }
        : (target as unknown as Record<string | symbol, unknown>)[key],
    });
    readAgentRecords(spy, { workState: undefined, now: Date.now() });
    expect(statements.some(sql => sql.includes('GROUP BY +session_db_id'))).toBe(true);
    expect(statements.some(sql => sql.includes('SELECT DISTINCT tool_name'))).toBe(false);
  });
});

function insertToolUse(id: number, toolName: string, input: string, epoch: number): void {
  db.prepare(`INSERT INTO tool_uses (id, tool_use_id, content_session_id, project, tool_name, tool_input, tool_response, created_at, created_at_epoch)
    VALUES (?, ?, 's1', 'p', ?, ?, '{}', ?, ?)`).run(id, `tu-${id}`, toolName, input, new Date(epoch).toISOString(), epoch);
}

describe('work view statements return the rows the old ones did', () => {
  it('splits the publishing OR into statements that merge to the same ids, order and limit', () => {
    const names = ['Artifact', 'artifact', 'mcp__claude_ai_Claude_Docs__batch', 'mcp__x__chatgpt_space__create_page', 'Mcp__X__CHATGPT_SPACE__CREATE_PAGE',
      'mcp__y__sites__save_version_and_deploy', 'mcp__y__sites__save_version_and_deploy_extra', 'Bash', 'Read', 'mcp__x__chatgptXspace__create_page'];
    let id = 0;
    for (let round = 0; round < 6; round++) for (const name of names) {
      insertToolUse(++id, name, name === 'Bash' ? JSON.stringify({ command: round % 2 ? 'gh pr create --fill' : 'ls' }) : '{}', 1000 + id * 10);
    }
    for (const sinceEpoch of [0, 1300, 1600]) for (const limit of [3, 17, 2000]) {
      const old = db.prepare(OLD_PUBLISHING_SQL).all(sinceEpoch, limit) as Array<{ id: number }>;
      const { productCalls } = readProductRecords((sql: string, params: unknown[]) => db.prepare(sql).all(...params) as never[], sinceEpoch, limit);
      const gitIds = new Set((db.prepare(`SELECT id FROM tool_uses WHERE tool_name = 'Bash' AND tool_input LIKE '%git%'`).all() as Array<{ id: number }>).map(row => row.id));
      const publishing = (productCalls as Array<{ id: number }>).filter(call => !gitIds.has(call.id));
      expect(publishing.map(call => call.id)).toEqual(old.map(row => row.id));
    }
  });

  it('finds every distinct tool name, in order, and matches LIKE patterns the way SQLite does', () => {
    const names = ['Artifact', 'artifact', 'mcp__x__chatgpt_space__create_page', 'mcp__x__chatgptXspace__create_page', 'zzz', 'Read'];
    names.forEach((name, index) => insertToolUse(index + 1, name, '{}', 1000 + index));
    const read = (sql: string, params: unknown[]) => db.prepare(sql).all(...params) as Array<{ tool_name: string }>;
    expect(distinctToolNames(read, () => true)).toEqual([...names].sort());
    for (const pattern of ['%chatgpt_space__create_page', '%sites__save_version_and_deploy%', '%work_state_write%', 'art%', '_rtifact']) {
      const matches = likeMatcher(pattern);
      for (const name of [...names, 'ARTIFACT', 'mcp__z__WORK_STATE_WRITE', 'a\nrtifact']) {
        const sqlite = db.prepare('SELECT ? LIKE ? AS hit').get(name, pattern) as { hit: number };
        expect({ pattern, name, hit: matches(name) }).toEqual({ pattern, name, hit: sqlite.hit === 1 });
      }
    }
  });

  it('the ranged recent-asks statement names the same sessions as the grouped one', () => {
    for (let session = 1; session <= 5; session++) {
      db.prepare(`INSERT INTO sdk_sessions (id, content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
        VALUES (?, ?, ?, 'p', 'x', 1000, 'active')`).run(session, `c${session}`, `m${session}`);
    }
    let prompt = 0;
    for (const [session, epoch] of [[1, 100], [2, 900], [2, 950], [3, 400], [5, 800], [4, 10]] as const) {
      db.prepare(`INSERT INTO user_prompts (id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch, session_db_id)
        VALUES (?, ?, ?, 'ask', 'x', ?, ?)`).run(++prompt, `c${session}`, prompt, epoch, session);
    }
    const { sql: issuedSql } = recentAsksStatement(2000);
    for (const [since, limit] of [[0, 600], [300, 600], [0, 2], [850, 600]] as const) {
      const old = (db.prepare(OLD_RECENT_ASKS_SQL).all(since, limit) as Array<{ id: number }>).map(row => row.id).sort();
      const now = (db.prepare(issuedSql).all(since, limit) as Array<{ id: number }>).map(row => row.id).sort();
      expect(now).toEqual(old);
    }
  });
});
