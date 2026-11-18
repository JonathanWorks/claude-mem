import { describe, it, expect, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';

describe('SessionStore work state (v61)', () => {
  let store: SessionStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  it('creates the table and stamps schema version 61', () => {
    store = new SessionStore(':memory:');

    const versions = store.db.query('SELECT version FROM schema_versions WHERE version = 61').all();
    const tables = store.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = 'work_state_entries'").all();
    expect(versions).toHaveLength(1);
    expect(tables).toHaveLength(1);
  });

  it('returns entries oldest first with their fields as written, including null', () => {
    store = new SessionStore(':memory:');
    store.appendWorkStateEntry({ project: 'acme', listName: 'release', fields: { version: '13.25.2', blocked_on: 'npm token' }, createdAtEpoch: 1_000 });
    store.appendWorkStateEntry({ project: 'acme', listName: 'release', fields: { blocked_on: null, attempt: 2, shipped: false }, createdAtEpoch: 2_000 });

    const entries = store.getWorkStateEntries(['acme']);

    expect(entries.map(entry => entry.fields)).toEqual([
      { version: '13.25.2', blocked_on: 'npm token' },
      { blocked_on: null, attempt: 2, shipped: false },
    ]);
    expect(entries.map(entry => entry.created_at_epoch)).toEqual([1_000, 2_000]);
    expect(entries.every(entry => entry.list_name === 'release' && entry.project === 'acme')).toBe(true);
  });

  describe('appendWorkStateEntriesAtomically', () => {
    it('saves every entry and runs beforeCommit inside the same transaction, after the last insert', () => {
      store = new SessionStore(':memory:');
      const seenInside: number[] = [];
      store.appendWorkStateEntriesAtomically([
        { project: 'acme', listName: 'my-focus', fields: { focus_area_id: 'fa_1' } },
        { project: 'acme', listName: 'owner-goals', fields: { task: 'Ask: one', status: 'todo' } },
      ], () => { seenInside.push(store!.getWorkStateEntries(['acme']).length); });

      // EXECUTION: beforeCommit ran, and saw both rows already inserted, inside the open transaction.
      expect(seenInside).toEqual([2]);
      expect(store.getWorkStateEntries(['acme']).map(entry => entry.list_name)).toEqual(['my-focus', 'owner-goals']);
    });

    it('rolls every entry back when beforeCommit throws, and when a later insert fails', () => {
      store = new SessionStore(':memory:');
      store.appendWorkStateEntry({ project: 'acme', listName: 'kept', fields: { before: true } });
      let ran = false;
      expect(() => store!.appendWorkStateEntriesAtomically([
        { project: 'acme', listName: 'my-focus', fields: { focus_area_id: 'fa_1' } },
        { project: 'acme', listName: 'owner-goals', fields: { task: 'Ask: one' } },
      ], () => { ran = true; throw new Error('the file write failed'); })).toThrow('the file write failed');
      expect(ran).toBe(true);
      expect(store.getWorkStateEntries(['acme']).map(entry => entry.list_name)).toEqual(['kept']);

      // A row that cannot be stored (a null project violates NOT NULL) fails after the first insert succeeded: that first row is rolled back too.
      expect(() => store!.appendWorkStateEntriesAtomically([
        { project: 'acme', listName: 'my-focus', fields: { focus_area_id: 'fa_2' } },
        { project: null as unknown as string, listName: 'owner-goals', fields: { task: 'Ask: two' } },
      ])).toThrow();
      expect(store.getWorkStateEntries(['acme']).map(entry => entry.list_name)).toEqual(['kept']);
    });
  });

  it('reads every requested project key, case-insensitively, and leaves other projects out', () => {
    store = new SessionStore(':memory:');
    store.appendWorkStateEntry({ project: 'acme', listName: 'release', fields: { version: '1.0' } });
    store.appendWorkStateEntry({ project: 'acme/feature-tree', listName: 'todo', fields: { task: 'tests' } });
    store.appendWorkStateEntry({ project: 'other', listName: 'todo', fields: { task: 'unrelated' } });

    const entries = store.getWorkStateEntries(['ACME', 'acme/feature-tree']);

    expect(entries.map(entry => entry.project)).toEqual(['acme', 'acme/feature-tree']);
    expect(store.getWorkStateEntries([])).toEqual([]);
  });

  it('narrows to one list when named', () => {
    store = new SessionStore(':memory:');
    store.appendWorkStateEntry({ project: 'acme', listName: 'release', fields: { version: '1.0' } });
    store.appendWorkStateEntry({ project: 'acme', listName: 'todo', fields: { task: 'tests' } });

    expect(store.getWorkStateEntries(['acme'], 'todo').map(entry => entry.list_name)).toEqual(['todo']);
  });
});
