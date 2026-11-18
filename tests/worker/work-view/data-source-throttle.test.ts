import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { activitySignature } from '../../../src/services/work-view/agent-view.mjs';
import { WorkStateSource } from '../../../src/services/work-view/data-source.mjs';
import { ruleRowFields } from '../../../src/services/work-view/my-rules.mjs';

let directory: string;
let databasePath: string;
let store: SessionStore;
let sources: WorkStateSource[];
let clock: number;
let tick: number;

const writer = (): Database => (store as unknown as { db: Database }).db;

function openSource(activityRefreshMs: number): WorkStateSource {
  const source = new WorkStateSource({ databasePath, activityRefreshMs, now: () => { clock += tick; return clock; } });
  sources.push(source);
  return source;
}

let toolUse = 0;
/** A recorded tool call: activity that is not a work-state row. */
function recordToolCall(): void {
  toolUse++;
  writer().prepare(`INSERT INTO tool_uses (tool_use_id, content_session_id, project, tool_name, tool_input, tool_response, created_at, created_at_epoch)
    VALUES (?, 's1', 'p', 'Read', '{}', '{}', ?, ?)`).run(`tu-${toolUse}`, new Date().toISOString(), Date.now());
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'work-view-throttle-'));
  databasePath = join(directory, 'claude-mem.db');
  store = new SessionStore(databasePath);
  sources = []; clock = 1_000_000; tick = 0; toolUse = 0;
});

afterEach(() => {
  sources.forEach(source => source.close());
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

const revisionOf = (source: WorkStateSource): number => source.read().agentView.revision as number;

describe('WorkStateSource activity throttle', () => {
  it('rebuilds on an activity-only change at most once per window, and again after it', () => {
    const source = openSource(5000);
    const first = revisionOf(source);
    recordToolCall();
    clock += 100;
    expect(revisionOf(source)).toBe(first);
    clock += 4800;
    expect(revisionOf(source)).toBe(first);
    clock += 200;
    expect(revisionOf(source)).toBe(first + 1);
    expect(revisionOf(source)).toBe(first + 1);
  });

  it('an unthrottled source rebuilds on every activity change', () => {
    const source = openSource(0);
    const first = revisionOf(source);
    recordToolCall();
    expect(revisionOf(source)).toBe(first + 1);
  });

  it('a work-state row is read back at once, inside the window', () => {
    const source = openSource(60_000);
    const first = revisionOf(source);
    store.appendWorkStateEntry({ project: 'p', listName: 'example-work', fields: { task: 'Saved now', status: 'done' } });
    clock += 1;
    expect(revisionOf(source)).toBe(first + 1);
  });

  it('waits twice as long as the last build took when that is longer than the window', () => {
    tick = 2000;
    const source = openSource(1000);
    const first = revisionOf(source);
    tick = 0;
    const builtAt = clock;
    recordToolCall();
    clock = builtAt + 3999;
    expect(revisionOf(source)).toBe(first);
    clock = builtAt + 4000;
    expect(revisionOf(source)).toBe(first + 1);
  });

  it('a source that could not be read rebuilds as soon as it can', () => {
    const source = openSource(60_000);
    source.read();
    source.close();
    source.source.connected = false;
    expect(source.read().source.connected).toBe(true);
  });
});

describe('WorkStateSource.readRules', () => {
  const rule = {
    ruleId: 'own_one', scopeId: '', scopeTier: 'everywhere', scopeName: 'Everywhere', when: '', then: 'Keep answers short.', setBy: 'owner',
    status: 'on', kind: 'directive', source: 'you', timesSeen: 1, latestAt: null, quotes: [], replacedBy: null, replacedAt: null, savedAt: null,
  };

  it('reads the saved rules without the activity scan, and the next full read still builds the view', () => {
    store.appendWorkStateEntry({ project: 'home', listName: 'my-rules', fields: ruleRowFields(rule) });
    const source = openSource(0);
    const database = source.openDatabase() as Database;
    const prepared: string[] = [];
    const original = database.prepare.bind(database);
    (database as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => { prepared.push(sql); return original(sql); };
    expect(source.readRules()).toMatchObject({ connected: true, rules: [expect.objectContaining({ ruleId: 'own_one', then: 'Keep answers short.' })] });
    expect(prepared.join('\n')).not.toMatch(/tool_uses|user_prompts|sdk_sessions|observations|data_version/);
    const view = source.read().agentView;
    expect(view.revision).toBe(1);
    expect((view.rules as Array<{ ruleId: string }>).map(entry => entry.ruleId)).toEqual(['own_one']);
  });

  it('answers not connected, with no rules, when the database is missing', () => {
    const source = new WorkStateSource({ databasePath: join(directory, 'missing.db') });
    sources.push(source);
    expect(source.readRules()).toEqual({ connected: false, rules: [] });
  });
});

describe('activitySignature', () => {
  it('changes on an insert, an update and a delete made by another connection', () => {
    recordToolCall();
    recordToolCall();
    const reader = new Database(databasePath, { readonly: true });
    try {
      const seen = [activitySignature(reader)];
      const changed = (label: string, write: () => void) => {
        write();
        const next = activitySignature(reader);
        expect({ label, same: seen.includes(next) }).toEqual({ label, same: false });
        seen.push(next);
      };
      changed('insert', recordToolCall);
      changed('update keeping the newest id', () => writer().prepare("UPDATE tool_uses SET tool_name = 'Edit' WHERE id = 1").run());
      changed('delete of an older row', () => writer().prepare('DELETE FROM tool_uses WHERE id = 1').run());
      expect(seen[0]).not.toMatch(/count/i);
    } finally { reader.close(); }
  });

  it('answers on a fixture database that has none of the activity tables', () => {
    const bare = new Database(':memory:');
    expect(activitySignature(bare)).toMatch(/^observations:0\|session_summaries:0\|tool_uses:0\|user_prompts:0\|sdk_sessions:0\|data:\d+$/);
    bare.close();
  });
});
