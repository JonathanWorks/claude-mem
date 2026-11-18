import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import express from 'express';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { WorkViewRoutes } from '../../../../src/services/worker/http/routes/WorkViewRoutes.js';
import { reduceWorkState } from '../../../../src/services/work-view/data-source.mjs';
import { buildFocusAreas } from '../../../../src/services/work-view/my-focus.mjs';
import { scratchDir } from '../../../helpers/scratch-dir.js';

// POST /api/work-view/owner-goals/save: the whole owner-goals save as ONE request, all or nothing. The real routes over real HTTP, in front
// of a real SQLite database whose atomic store is a real transaction, with a fault injected in the store where a test needs one.

const TABLES = `
  CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER);
  CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, project TEXT, platform_source TEXT, content_session_id TEXT, memory_session_id TEXT,
    user_prompt TEXT, custom_title TEXT, status TEXT, started_at_epoch INTEGER, completed_at_epoch INTEGER);
  CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER);
  CREATE TABLE observations (id INTEGER PRIMARY KEY, project TEXT, memory_session_id TEXT, content_session_id TEXT, agent_id TEXT, agent_type TEXT,
    prompt_number INTEGER, title TEXT, subtitle TEXT, type TEXT, created_at_epoch INTEGER, narrative TEXT);
  CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, project TEXT, memory_session_id TEXT, prompt_number INTEGER, request TEXT, completed TEXT, next_steps TEXT, created_at_epoch INTEGER);
  CREATE TABLE tool_uses (id INTEGER PRIMARY KEY, project TEXT, platform_source TEXT, agent_id TEXT, agent_type TEXT, session_db_id INTEGER, memory_session_id TEXT,
    content_session_id TEXT, prompt_number INTEGER, tool_input TEXT, created_at_epoch INTEGER, tool_name TEXT);`;

const quote = (at: string, words: string) => [{ at, quote: words }];
const GOALS = {
  generated_at: '2026-10-21T09:30:00-07:00', window_days: 31, source_prompt_count: 5, human_summary: 'Viewer work.',
  focus_areas: [{ rank: 1, title: 'Viewer', goal: 'A live view of my work.', matches: null, latest_at: '2026-10-20 10:00', times_asked: 2, evidence: quote('2026-10-20 10:00', 'keep it live') }],
  asks: [{ rank: 1, title: 'Viewer cards', focus_area: 'Viewer', latest_at: '2026-10-20 10:00', times_asked: 1, evidence: quote('2026-10-20 10:00', 'ship the viewer cards') }],
  rules: [{ when: 'work is approved', then: 'Carry it through release without the owner publishing.', latest_at: '2026-10-21 09:00', times_asked: 1, evidence: quote('2026-10-21 09:00', 'never make me publish anything myself') }],
};
const OWN = { preference: 'Keep the existing design.', kind: 'directive', supportCount: 2, quotes: [] };

let directory: string;
let database: Database;
let routes: WorkViewRoutes;
let server: Server;
let origin: string;
let ledgerDir: string;
/** What the atomic store did: how many saves entered it, how many rows they inserted, how many committed. */
let store: { entered: number; rowsInserted: number; committed: number; failAtRow: number | null; failBeforeCommit: boolean; breakStoryBeforeFail: boolean; lockLedgerBeforeFail: boolean };
let lastEpoch: number;
const storyFile = () => join(ledgerDir, 'story.json');

const insert = (entry: { project: string; listName: string; fields: Record<string, unknown> }) => {
  lastEpoch = Math.max(Date.now(), lastEpoch + 1);
  database.query('INSERT INTO work_state_entries (project, list_name, fields, created_at_epoch) VALUES (?, ?, ?, ?)')
    .run(entry.project, entry.listName, JSON.stringify(entry.fields), lastEpoch);
};
const rows = () => database.query('SELECT id, project, list_name, fields, created_at_epoch FROM work_state_entries ORDER BY id').all() as
  Array<{ id: number; project: string; list_name: string; fields: string; created_at_epoch: number }>;
const state = () => reduceWorkState(rows());
const focusAreas = () => buildFocusAreas(state()).focusAreas;
const listTasks = (name = 'owner-goals') => (state().lists.find((list: { name: string }) => list.name === name)?.tasks ?? []) as Array<{ name: string; status: string; fields: Record<string, unknown> }>;

function serve(options: { atomic: boolean }): Promise<void> {
  routes = new WorkViewRoutes({
    getCloudSync: () => null, databasePath: join(directory, 'source.db'), reviewPath: join(directory, 'review.db'), pollIntervalMs: 20, humanCopy: null,
    ledgerDir, setupStatePath: join(directory, 'setup-state.json'), homeProject: 'home',
    appendWorkStateEntry: insert,
    appendWorkStateEntriesAtomically: options.atomic ? (entries, beforeCommit) => {
      store.entered++;
      database.transaction(() => {
        for (const [index, entry] of entries.entries()) {
          if (store.failAtRow !== null && index + 1 === store.failAtRow) throw new Error(`injected store fault before row ${index + 1}`);
          insert(entry);
          store.rowsInserted++;
        }
        beforeCommit?.();
        if (store.failBeforeCommit) {
          // The restore of the story cannot work: a folder stands where story.json was, so neither writing nor unlinking it succeeds.
          if (store.breakStoryBeforeFail) { rmSync(storyFile(), { force: true }); mkdirSync(storyFile()); }
          // The restore fails partway: the folder takes no new file, so the atomic restore cannot even write its temp file.
          if (store.lockLedgerBeforeFail) chmodSync(ledgerDir, 0o555);
          throw new Error('injected store fault before the commit');
        }
      })();
      store.committed++;
    } : null,
  });
  const app = express();
  app.use(express.json());
  routes.setupRoutes(app);
  return new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test port');
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

beforeEach(async () => {
  directory = scratchDir('owner-goals-save');
  database = new Database(join(directory, 'source.db'));
  database.exec('PRAGMA journal_mode=WAL');
  database.exec(TABLES);
  ledgerDir = join(directory, 'work-view');
  mkdirSync(ledgerDir);
  store = { entered: 0, rowsInserted: 0, committed: 0, failAtRow: null, failBeforeCommit: false, breakStoryBeforeFail: false, lockLedgerBeforeFail: false };
  lastEpoch = 0;
  await serve({ atomic: true });
});

afterEach(async () => {
  routes.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

const save = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  fetch(`${origin}/api/work-view/owner-goals/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
const saveOk = async (body: Record<string, unknown>) => { const response = await save(body); expect(response.status).toBe(200); return response.json(); };
const refusedWith = async (body: Record<string, unknown>, status = 400) => {
  const response = await save(body);
  expect(response.status).toBe(status);
  const answer = await response.json();
  expect(answer.applied).toBe(false);
  return answer.problems as string[];
};
const goalsWith = (overrides: Record<string, unknown>) => ({ ...GOALS, ...overrides });
const area = (overrides: Record<string, unknown> = {}) => ({ ...GOALS.focus_areas[0], ...overrides });
const seedStory = () => writeFileSync(storyFile(), JSON.stringify({ narrative: 'The story.', preferences: [OWN, { preference: 'An old owner-goals rule.', source: 'owner-goals', quotes: [] }] }));
/** Nothing of a refused or failed save is left: no row, no area, and the story as it was. */
const untouched = () => ({ rows: rows(), story: existsSync(storyFile()) ? readFileSync(storyFile(), 'utf8') : null });

describe('POST /api/work-view/owner-goals/save', () => {
  it('saves the areas, the rows and the rules in ONE transaction, story.json inside it, and answers what it saved', async () => {
    seedStory();
    const answer = await saveOk({ goals: GOALS, ledgerDir });
    expect(answer).toMatchObject({ applied: true, alreadyApplied: false, list: 'owner-goals', history: false, savedFocusAreas: 1, savedAsks: 1, savedRules: 1, newFocusAreas: 1, droppedPreviousItems: 0, rulesFile: storyFile() });
    // EXECUTION: the store was entered once, inserted the area row and the three owner-goals rows, and committed.
    expect(store).toMatchObject({ entered: 1, rowsInserted: 4, committed: 1 });
    const [saved] = focusAreas();
    expect(saved).toMatchObject({ name: 'Viewer', status: 'suggested', source: 'owner-goals', decidedBy: 'system', priorityRank: 1 });
    expect(answer.focusAreaIds).toEqual([saved.focusAreaId]);
    expect(listTasks().map((task) => [task.name, task.fields.goal_kind, task.fields.focus_area_id])).toEqual([['Focus area: Viewer', 'focus-area', saved.focusAreaId], ['Ask: Viewer cards', 'ask', saved.focusAreaId]]);
    const story = JSON.parse(readFileSync(storyFile(), 'utf8'));
    expect(story.preferences.map((preference: { preference: string }) => preference.preference)).toEqual(['Keep the existing design.', 'Carry it through release without the owner publishing.']);
    // Every row is under the home project; the list state carries the content key.
    expect(new Set(rows().map((row) => row.project))).toEqual(new Set(['home']));
    expect(state().lists.find((list: { name: string }) => list.name === 'owner-goals').fields.save_key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a store that fails after the first area row rolls it back: 500, nothing written, no story.json', async () => {
    store.failAtRow = 2;
    const problems = await refusedWith({ goals: GOALS }, 500);
    expect(problems.join()).toContain('injected store fault before row 2');
    expect(problems.join()).toContain('nothing was written');
    // EXECUTION: the store was entered and a row was inserted before the fault, so there was something for SQLite to roll back.
    expect(store).toMatchObject({ entered: 1, rowsInserted: 1, committed: 0 });
    expect(untouched()).toEqual({ rows: [], story: null });
    expect(focusAreas()).toEqual([]);
  });

  it('a store that fails on the last row, or at the commit, leaves nothing either: the story written before the commit failed is put back', async () => {
    seedStory();
    const before = untouched();
    store.failAtRow = 4;
    await refusedWith({ goals: GOALS }, 500);
    expect(store).toMatchObject({ entered: 1, rowsInserted: 3, committed: 0 });
    expect(untouched()).toEqual(before);
    store.failAtRow = null;
    store.failBeforeCommit = true;
    await refusedWith({ goals: GOALS }, 500);
    // EXECUTION: every row was inserted and the story was written before the commit failed; both are gone again.
    expect(store).toMatchObject({ entered: 2, rowsInserted: 7, committed: 0 });
    expect(untouched()).toEqual(before);
    // With no story to begin with, the one written before the failed commit is removed.
    unlinkSync(storyFile());
    await refusedWith({ goals: GOALS }, 500);
    expect(untouched()).toEqual({ rows: [], story: null });
    store.failBeforeCommit = false;
    expect((await saveOk({ goals: GOALS })).applied).toBe(true);
    expect(JSON.parse(readFileSync(storyFile(), 'utf8')).preferences).toHaveLength(1);
  });

  it('a commit that fails after story.json was written, when the story cannot be put back, says the file holds the new rules, names it, and is ambiguous', async () => {
    for (const withStory of [true, false]) {
      if (withStory) seedStory();
      store.failBeforeCommit = true;
      store.breakStoryBeforeFail = true;
      const response = await save({ goals: GOALS });
      const answer = await response.json();
      expect(response.status).toBe(500);
      expect(answer).toMatchObject({ applied: false, ambiguous: true, rulesFile: storyFile() });
      const text = answer.problems.join(' ');
      expect(text).toContain('rolled back');
      expect(text).toContain(storyFile());
      expect(text).toContain('holds the new rules, whole and readable');
      expect(text).toContain('could not be put back');
      expect(text).toContain('running the same save again replaces those same rules');
      expect(text).not.toContain('nothing was written');
      // EXECUTION: the store inserted every row and ran the story write before the fault; the rows are gone, the file is the one thing left.
      expect(rows()).toEqual([]);
      expect(store.rowsInserted).toBeGreaterThan(0);
      rmSync(storyFile(), { recursive: true, force: true });
    }
    // The rerun replaces the same rules: with the cause gone the save is applied once and the story holds one owner-goals rule.
    store.failBeforeCommit = false;
    store.breakStoryBeforeFail = false;
    seedStory();
    expect((await saveOk({ goals: GOALS })).applied).toBe(true);
    expect(JSON.parse(readFileSync(storyFile(), 'utf8')).preferences.filter((preference: { source?: string }) => preference.source === 'owner-goals')).toHaveLength(1);
    // A failure whose restore works stays a plain 500 that says nothing was written and is not ambiguous.
    store.failBeforeCommit = true;
    const plain = await (await save({ goals: goalsWith({ generated_at: '2026-10-23T09:30:00-07:00' }) })).json();
    expect(plain.ambiguous).toBeUndefined();
    expect(plain.problems.join()).toContain('nothing was written');
    expect(plain.problems.join()).not.toContain('..');
  });

  it('a story restore that fails partway leaves story.json whole (the new rules, never a fragment), and a rerun succeeds', async () => {
    for (const withStory of [true, false]) {
      if (withStory) seedStory();
      store.failBeforeCommit = true;
      store.lockLedgerBeforeFail = true;
      try {
        const response = await save({ goals: GOALS });
        const answer = await response.json();
        expect(response.status).toBe(500);
        // EXECUTION: the store ran the story write and reached the fault, and the restore was entered and failed (the answer is ambiguous).
        expect(store.rowsInserted).toBeGreaterThan(0);
        expect(answer).toMatchObject({ applied: false, ambiguous: true, rulesFile: storyFile() });
        expect(answer.problems.join(' ')).toContain('holds the new rules, whole and readable');
        expect(rows()).toEqual([]);
        // The file parses, and holds the new owner-goals rule: the old bytes were never half-overwritten.
        const story = JSON.parse(readFileSync(storyFile(), 'utf8'));
        expect(story.preferences.filter((preference: { source?: string }) => preference.source === 'owner-goals').map((preference: { preference: string }) => preference.preference))
          .toEqual(['Carry it through release without the owner publishing.']);
      } finally { chmodSync(ledgerDir, 0o755); }
      // No temp file is left beside it.
      expect(readdirSync(ledgerDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      store.failBeforeCommit = false;
      store.lockLedgerBeforeFail = false;
      expect((await saveOk({ goals: goalsWith({ generated_at: `2026-10-2${withStory ? 3 : 4}T09:30:00-07:00` }) })).applied).toBe(true);
      expect(JSON.parse(readFileSync(storyFile(), 'utf8')).preferences.filter((preference: { source?: string }) => preference.source === 'owner-goals')).toHaveLength(1);
      unlinkSync(storyFile());
      database.exec('DELETE FROM work_state_entries');
    }
  });

  it('a story restore that works is atomic: the old bytes come back exactly and no temp file stays beside them', async () => {
    seedStory();
    const before = readFileSync(storyFile());
    store.failBeforeCommit = true;
    await refusedWith({ goals: GOALS }, 500);
    expect(readFileSync(storyFile()).equals(before)).toBe(true);
    expect(readdirSync(ledgerDir)).toEqual(['story.json']);
  });

  it('a story.json that cannot be written rolls every row back: 500, nothing written, no area', async () => {
    // A ledger folder nobody can write in: the finished story cannot be created, after every row was inserted.
    if (process.getuid?.() === 0) return;
    seedStory();
    const before = untouched();
    chmodSync(ledgerDir, 0o500);
    try {
      const problems = await refusedWith({ goals: GOALS }, 500);
      expect(problems.join()).toContain('nothing was written');
    } finally { chmodSync(ledgerDir, 0o700); }
    expect(store).toMatchObject({ entered: 1, rowsInserted: 4, committed: 0 });
    expect(untouched()).toEqual(before);
    expect(focusAreas()).toEqual([]);
  });

  it('a matched area\'s rank row and the goal rows are one transaction: a fault after the rank row leaves the rank, the rows and the story as they were', async () => {
    seedStory();
    await saveOk({ goals: GOALS });
    const [saved] = focusAreas();
    const before = untouched();
    const next = goalsWith({ generated_at: '2026-10-22T09:30:00-07:00', focus_areas: [area({ matches: saved.focusAreaId, rank: 4 })] });
    store.failAtRow = 2;
    await refusedWith({ goals: next }, 500);
    // EXECUTION: the rank row (the first of this save) was inserted, then the fault.
    expect(store).toMatchObject({ entered: 2, rowsInserted: 5, committed: 1 });
    expect(untouched()).toEqual(before);
    expect(focusAreas()[0]).toMatchObject({ focusAreaId: saved.focusAreaId, priorityRank: 1 });
    store.failAtRow = null;
    await saveOk({ goals: next });
    expect(focusAreas()).toHaveLength(1);
    expect(focusAreas()[0]).toMatchObject({ focusAreaId: saved.focusAreaId, priorityRank: 4 });
  });

  it('a refused row after a matched area refuses the whole save before the store is entered: nothing of the rank change is written', async () => {
    await saveOk({ goals: GOALS });
    const [saved] = focusAreas();
    const before = untouched();
    const entered = store.entered;
    const problems = await refusedWith({ goals: goalsWith({ generated_at: '2026-10-22T09:30:00-07:00', focus_areas: [area({ matches: saved.focusAreaId, rank: 4 })], asks: [{ ...GOALS.asks[0], times_asked: 2 ** 53 }] }) });
    expect(problems.join()).toContain('safe');
    expect(store.entered).toBe(entered);
    expect(untouched()).toEqual(before);
    expect(focusAreas()[0].priorityRank).toBe(1);
  });

  it('a match to an area that is not saved is refused with the focus route\'s words, nothing written', async () => {
    const problems = await refusedWith({ goals: goalsWith({ focus_areas: [area({ matches: 'fa_000000000000' })] }) });
    expect(problems.join()).toContain('fa_000000000000, which is not a saved focus area');
    expect(store.entered).toBe(0);
    expect(rows()).toEqual([]);
  });

  it('refuses what the write routes refuse, every problem at once, each named by item, and enters no transaction', async () => {
    const problems = await refusedWith({ goals: goalsWith({
      focus_areas: [area({ title: 'n'.repeat(81) }), area({ title: 'Second', rank: 0 })],
      asks: [{ ...GOALS.asks[0], focus_area: null, times_asked: 2 ** 53 }],
      rules: [{ ...GOALS.rules[0], then: 'r'.repeat(201) }],
    }) });
    expect(problems.filter((problem) => problem.startsWith('focus area 1')).join()).toContain('name');
    expect(problems.filter((problem) => problem.startsWith('focus area 2')).join()).toContain('rank');
    expect(problems.filter((problem) => problem.startsWith('row 4 (Ask: Viewer cards)')).join()).toContain('safe');
    expect(problems.filter((problem) => problem.startsWith('rule 1')).join()).toContain('UTF-16');
    expect(store.entered).toBe(0);
    expect(untouched()).toEqual({ rows: [], story: null });
  });

  it('counts a rule in UTF-16 code units, as the ledger route does: 100 emoji pass, 101 do not', async () => {
    const rule = (count: number) => ({ ...GOALS.rules[0], then: '\u{1F680}'.repeat(count) });
    expect((await refusedWith({ goals: goalsWith({ rules: [rule(101)] }) })).join()).toContain('UTF-16');
    expect((await saveOk({ goals: goalsWith({ rules: [rule(100)] }) })).applied).toBe(true);
  });

  it('refuses a boolean where a number is due, and a quote time that is not a minute, naming the field', async () => {
    expect((await refusedWith({ goals: goalsWith({ focus_areas: [area({ rank: true })] }) })).join()).toContain('rank');
    expect((await refusedWith({ goals: goalsWith({ window_days: true }) })).join()).toContain('window_days');
    expect((await refusedWith({ goals: goalsWith({ rules: [{ ...GOALS.rules[0], times_asked: true }] }) })).join()).toContain('times_asked');
    expect((await refusedWith({ goals: goalsWith({ rules: [{ ...GOALS.rules[0], evidence: quote('yesterday', 'never make me') }] }) })).join()).toContain('quote time');
    expect((await refusedWith({ goals: goalsWith({ asks: [{ ...GOALS.asks[0], focus_area: 'Releases' }] }) })).join()).toContain('focus_area');
    expect((await refusedWith({ goals: goalsWith({ focus_areas: [GOALS.focus_areas[0], GOALS.focus_areas[0]] }) })).join()).toContain('share the title');
    expect((await refusedWith({ goals: goalsWith({ asks: 'not a list' }) })).join()).toContain('"asks" must be a list');
    expect(store.entered).toBe(0);
  });

  it('is idempotent by content: the same save again is recognized and changes nothing, a different one is applied', async () => {
    seedStory();
    const first = await saveOk({ goals: GOALS });
    const afterFirst = untouched();
    const again = await saveOk({ goals: GOALS });
    expect(again).toMatchObject({ applied: true, alreadyApplied: true, list: 'owner-goals', savedFocusAreas: 1, savedAsks: 1, savedRules: 1, droppedPreviousItems: null, rulesFile: storyFile() });
    expect(first.alreadyApplied).toBe(false);
    // EXECUTION: the second request was answered by the key, so the store ran once and nothing was written again.
    expect(store).toMatchObject({ entered: 1, committed: 1 });
    expect(untouched()).toEqual(afterFirst);
    expect(focusAreas()).toHaveLength(1);
    const different = await saveOk({ goals: goalsWith({ generated_at: '2026-10-22T09:30:00-07:00' }) });
    expect(different.alreadyApplied).toBe(false);
    expect(store.entered).toBe(2);
  });

  it('rerunning an older save after a newer one is recognized: no second area, the list stays at the newer save, the store is not entered', async () => {
    const saveA = { goals: GOALS };
    const saveB = { goals: goalsWith({ generated_at: '2026-10-22T09:30:00-07:00', asks: [{ ...GOALS.asks[0], title: 'Only in B' }] }) };
    expect((await saveOk(saveA)).alreadyApplied).toBe(false);
    const [saved] = focusAreas();
    expect((await saveOk({ goals: goalsWith({ ...saveB.goals, focus_areas: [area({ matches: saved.focusAreaId })] }) })).alreadyApplied).toBe(false);
    const afterB = untouched();
    const listAfterB = listTasks().map((task) => [task.name, task.status]);
    expect(store.entered).toBe(2);
    const again = await saveOk(saveA);
    expect(again).toMatchObject({ applied: true, alreadyApplied: true });
    // EXECUTION: the rerun was answered by the remembered key; the store ran twice, not three times.
    expect(store.entered).toBe(2);
    expect(untouched()).toEqual(afterB);
    expect(focusAreas()).toHaveLength(1);
    expect(listTasks().map((task) => [task.name, task.status])).toEqual(listAfterB);
    expect(listTasks().find((task) => task.name === 'Ask: Only in B')?.status).toBe('todo');
    // The newest save is still recognized too.
    expect((await saveOk({ goals: goalsWith({ ...saveB.goals, focus_areas: [area({ matches: saved.focusAreaId })] }) })).alreadyApplied).toBe(true);
  });

  it('generated_at decides nothing: a future-dated save blocks no later save, a missing one clears nothing, and each is applied as a new save', async () => {
    const future = await saveOk({ goals: goalsWith({ generated_at: '2099-01-01T00:00:00+00:00' }) });
    expect(future.alreadyApplied).toBe(false);
    const [saved] = focusAreas();
    // A later save with an earlier stamp is a new save, not refused (no 409), and a dry run of it plans its writes.
    const earlier = { goals: goalsWith({ generated_at: '2026-10-22T09:30:00-07:00', human_summary: 'After the future one.', focus_areas: [area({ matches: saved.focusAreaId })] }) };
    const dry = await saveOk({ ...earlier, dryRun: true });
    expect(dry).toMatchObject({ applied: false, dryRun: true, alreadyApplied: false });
    expect(dry.writes.length).toBeGreaterThan(0);
    expect((await saveOk(earlier)).alreadyApplied).toBe(false);
    // A save with no generated_at is applied too, and the stored time is recorded data only.
    const { generated_at: _gone, ...unstamped } = GOALS;
    const withoutStamp = { goals: { ...unstamped, human_summary: 'No stamp.', focus_areas: [area({ matches: saved.focusAreaId })] } };
    expect((await saveOk(withoutStamp)).alreadyApplied).toBe(false);
    // EXECUTION: all three reached the store.
    expect(store).toMatchObject({ entered: 3, committed: 3 });
    expect(state().lists[0].fields.human_summary).toBe('No stamp.');
    // Each is remembered: sending any again changes nothing.
    expect((await saveOk(earlier)).alreadyApplied).toBe(true);
    expect(store.entered).toBe(3);
  });

  it('a save forgotten by the bound is applied as a new save, with no refusal', async () => {
    for (let day = 1; day <= 12; day++) await saveOk({ goals: goalsWith({ generated_at: `2026-10-${String(10 + day).padStart(2, '0')}T09:30:00-07:00` }) });
    const entered = store.entered;
    expect(String(state().lists[0].fields.save_keys).split('\n')).toHaveLength(10);
    const [saved] = focusAreas();
    expect((await saveOk({ goals: goalsWith({ generated_at: '2026-10-11T09:30:00-07:00', focus_areas: [area({ matches: saved.focusAreaId })] }) })).alreadyApplied).toBe(false);
    expect(store.entered).toBe(entered + 1);
  });

  it('the map path is not part of the save: the same goals with a relative, an absolute or another spelling of it are one save', async () => {
    await saveOk({ goals: GOALS, mapPath: '/work/owner-map.md' });
    const entered = store.entered;
    for (const mapPath of ['owner-map.md', '/work/./sub/../owner-map.md', null]) {
      expect(await saveOk({ goals: GOALS, mapPath })).toMatchObject({ applied: true, alreadyApplied: true });
    }
    expect(store.entered).toBe(entered);
    expect(focusAreas()).toHaveLength(1);
  });

  it('two identical saves sent at once are applied once: the second waits its turn and is recognized', async () => {
    const [one, two] = await Promise.all([save({ goals: GOALS }), save({ goals: GOALS })]);
    const answers = [await one.json(), await two.json()];
    expect(answers.map((answer) => answer.alreadyApplied).sort()).toEqual([false, true]);
    expect(store).toMatchObject({ entered: 1, committed: 1 });
    expect(focusAreas()).toHaveLength(1);
  });

  it('a dry run plans and checks the save, answers what it would write, writes nothing, and leaves the save unapplied', async () => {
    const dry = await saveOk({ goals: GOALS, dryRun: true });
    expect(dry).toMatchObject({ applied: false, dryRun: true, alreadyApplied: false, list: 'owner-goals' });
    expect(dry.writes.slice(1).map((write: { task: string }) => write.task)).toEqual(['Focus area: Viewer', 'Ask: Viewer cards']);
    expect(dry.focusAreaRows).toHaveLength(1);
    expect(dry.rules).toHaveLength(1);
    expect(store.entered).toBe(0);
    expect(untouched()).toEqual({ rows: [], story: null });
    // A dry run that finds a problem says so the same way, and still writes nothing.
    expect((await refusedWith({ goals: goalsWith({ focus_areas: [area({ title: 'n'.repeat(81) })], asks: [] }), dryRun: true })).join()).toContain('name');
    expect((await saveOk({ goals: GOALS })).alreadyApplied).toBe(false);
  });

  it('a dry run of an already-applied save answers alreadyApplied true with no planned writes, and enters nothing', async () => {
    seedStory();
    await saveOk({ goals: GOALS });
    const afterFirst = untouched();
    const dry = await saveOk({ goals: GOALS, dryRun: true });
    expect(dry).toMatchObject({ applied: false, dryRun: true, alreadyApplied: true, list: 'owner-goals', writes: [], focusAreaRows: [], focusAreas: [], rules: [] });
    // EXECUTION: the first save entered the store once; the dry run entered nothing and wrote nothing.
    expect(store).toMatchObject({ entered: 1, committed: 1 });
    expect(untouched()).toEqual(afterFirst);
    // A dry run of a save never applied still lists its writes.
    expect((await saveOk({ goals: goalsWith({ human_summary: 'Not applied.' }), dryRun: true })).writes.length).toBeGreaterThan(0);
  });

  it('marks dropped the earlier items this save no longer has, and counts them', async () => {
    await saveOk({ goals: goalsWith({ asks: [GOALS.asks[0], { ...GOALS.asks[0], title: 'Second ask' }] }) });
    expect(listTasks().filter((task) => task.status === 'todo').map((task) => task.name).sort()).toEqual(['Ask: Second ask', 'Ask: Viewer cards', 'Focus area: Viewer']);
    const [saved] = focusAreas();
    const answer = await saveOk({ goals: goalsWith({ generated_at: '2026-10-22T09:30:00-07:00', focus_areas: [area({ matches: saved.focusAreaId })] }) });
    expect(answer).toMatchObject({ droppedPreviousItems: 1, newFocusAreas: 0 });
    expect(listTasks().find((task) => task.name === 'Ask: Second ask')?.status).toBe('dropped');
    expect(focusAreas()).toHaveLength(1);
  });

  it('refuses a ledger folder that is not the worker\'s, writing nothing, and accepts the worker\'s', async () => {
    const other = join(directory, 'another');
    const problems = await refusedWith({ goals: GOALS, ledgerDir: other });
    expect(problems.join()).toContain('This worker writes the request ledger in');
    expect(store.entered).toBe(0);
    expect(untouched()).toEqual({ rows: [], story: null });
    expect(existsSync(join(other, 'story.json'))).toBe(false);
    expect((await saveOk({ goals: GOALS, ledgerDir })).applied).toBe(true);
  });

  it('a past month is saved as history: its own list, rows done, no area, no rules written, and no ledger folder needed', async () => {
    const period = { start: '2025-11-01', end: '2025-12-01' };
    const answer = await saveOk({ goals: GOALS, period, mapPath: '/tmp-free/owner-map.md', ledgerDir: join(directory, 'another') });
    expect(answer).toMatchObject({ applied: true, history: true, list: 'owner-goals/2025-11-01', savedRules: 0, rulesFile: null, newFocusAreas: 0 });
    expect(focusAreas()).toEqual([]);
    expect(rows().every((row) => row.list_name === 'owner-goals/2025-11-01')).toBe(true);
    const [list] = state().lists;
    expect(list.fields).toMatchObject({ status: 'done', period_start: '2025-11-01', period_end: '2025-12-01', map_path: '/tmp-free/owner-map.md' });
    expect(list.tasks.every((task: { fields: Record<string, unknown> }) => task.fields.status === 'done' && (task.fields.focus_area_id ?? null) === null)).toBe(true);
    expect(existsSync(storyFile())).toBe(false);
    // A period that reaches today is the current month.
    const today = new Date();
    const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    expect((await saveOk({ goals: GOALS, period: { start: '2026-01-01', end: day(tomorrow) } })).list).toBe('owner-goals');
  });

  it('a period that is not two days in order is refused', async () => {
    expect((await refusedWith({ goals: GOALS, period: { start: '2025-12-01', end: '2025-11-01' } })).join()).toContain('end must be after start');
    expect((await refusedWith({ goals: GOALS, period: { start: 'November', end: '2025-12-01' } })).join()).toContain('YYYY-MM-DD');
  });

  it('a long summary and a long map path never refuse the save: the summary is cut to the room the state row has, and the key still fits', async () => {
    const mapPath = `/${'m'.repeat(400)}/owner-map.md`;
    await saveOk({ goals: goalsWith({ human_summary: 's'.repeat(1500) }), mapPath });
    const stateRow = rows().map((row) => JSON.parse(row.fields)).find((fields) => 'save_key' in fields);
    expect(JSON.stringify(stateRow).length).toBeLessThanOrEqual(2000);
    expect(stateRow.human_summary.length).toBeGreaterThan(1000);
    expect(stateRow.human_summary.length).toBeLessThan(1500);
    expect(stateRow.map_path).toBe(mapPath);
  });

  it('answers 503 on a worker with no atomic store and on one with no ledger, writing nothing', async () => {
    routes.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await serve({ atomic: false });
    expect((await refusedWith({ goals: GOALS }, 503)).join()).toContain('unavailable');
    routes.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    routes = new WorkViewRoutes({ getCloudSync: () => null, databasePath: join(directory, 'source.db'), reviewPath: join(directory, 'review.db'), pollIntervalMs: 20, humanCopy: null,
      ledgerDir: null, setupStatePath: join(directory, 'setup-state.json'), homeProject: 'home', appendWorkStateEntriesAtomically: () => { store.entered++; } });
    const app = express();
    app.use(express.json());
    routes.setupRoutes(app);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; resolve(); }); });
    expect((await refusedWith({ goals: GOALS }, 503)).join()).toContain('ledger is unavailable');
    expect(store.entered).toBe(0);
    expect(rows()).toEqual([]);
  });

  it('refuses a foreign origin, a proxied request and an unknown key like the other work-view writes', async () => {
    expect((await save({ goals: GOALS }, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await save({ goals: GOALS }, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(403);
    expect((await save({ goals: GOALS, extra: true })).status).toBe(400);
    expect((await save({ goals: 'not an object' })).status).toBe(400);
    expect(store.entered).toBe(0);
  });
});
