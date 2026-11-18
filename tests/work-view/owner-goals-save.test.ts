import { describe, expect, it } from 'bun:test';
import { appliedSaveKeys, goalsShapeProblems, localIsoOf, MAX_REMEMBERED_SAVE_KEYS, ownerGoalsSaveKey, planOwnerGoalsSave } from '../../src/services/work-view/owner-goals-save.mjs';
import { MAX_WORK_STATE_FIELDS_JSON_CHARS } from '../../src/services/work-view/work-state-limits.mjs';
import type { FocusArea } from '../../src/services/work-view/my-focus.mjs';

// The pure plan of an owner-goals save: every write, built from the goals file with the real focus area ids. Nothing here writes.

const quote = (at: string, words: string) => [{ at, quote: words }];
const goals = () => ({
  generated_at: '2026-10-21T09:30:00-07:00', window_days: 31, source_prompt_count: 5, human_summary: 'Viewer work.',
  focus_areas: [{ rank: 1, title: 'Viewer', goal: 'A live view of my work.', matches: null as string | null, latest_at: '2026-10-20 10:00', times_asked: 2, evidence: quote('2026-10-20 10:00', 'keep it live') }],
  asks: [{ rank: 1, title: 'Viewer cards', focus_area: 'Viewer' as string | null, latest_at: '2026-10-20 10:00', times_asked: 1, evidence: quote('2026-10-20 10:00', 'ship the viewer cards') }],
  rules: [{ when: 'work is approved', then: 'Carry it through release.', latest_at: '2026-10-21 09:00', times_asked: 1, evidence: quote('2026-10-21 09:00', 'never make me publish') }],
});
const context = { savedAreas: [] as FocusArea[], previousTasks: [] as string[], today: '2026-11-18', newId: (index: number) => `fa_${String(index).padStart(12, '0')}` };
const plan = (input: Parameters<typeof planOwnerGoalsSave>[0], overrides: Partial<typeof context> = {}) => {
  const planned = planOwnerGoalsSave(input, { ...context, ...overrides });
  if (!('listName' in planned)) throw new Error(`not planned: ${planned.problems.join('; ')}`);
  return planned;
};
const saved = (overrides: Partial<FocusArea>): FocusArea => ({
  focusAreaId: 'fa_aaaaaaaaaaaa', name: 'Viewer', goal: 'A live view.', about: null, status: 'suggested', priorityRank: 3, ownerRank: null, source: 'owner-goals',
  mergedInto: null, evidence: 'e', decidedBy: 'system', savedAt: null, ...overrides,
});

describe('localIsoOf', () => {
  it('is the quote\'s local minute with its offset, the same instant the local clock names', () => {
    const iso = localIsoOf('2026-10-21 09:00')!;
    expect(iso).toMatch(/^2026-10-21T09:00:00[+-]\d\d:\d\d$/);
    expect(Date.parse(iso)).toBe(new Date(2026, 9, 21, 9, 0).getTime());
  });

  it('is null for a minute that does not exist and for text that is not one', () => {
    for (const bad of ['2026-02-30 09:00', '2026-13-01 09:00', '2026-10-21 25:00', 'yesterday', '']) expect(localIsoOf(bad), bad).toBeNull();
  });
});

describe('ownerGoalsSaveKey', () => {
  it('is the same for the same content in any key order, and differs by any part of it', () => {
    const base = { goals: goals(), period: null, mapPath: null };
    const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys)
      : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reverseKeys(inner)])) : value;
    const reordered = { mapPath: null, period: null, goals: reverseKeys(goals()) as ReturnType<typeof goals> };
    expect(JSON.stringify(reordered.goals)).not.toBe(JSON.stringify(base.goals));
    expect(ownerGoalsSaveKey(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(ownerGoalsSaveKey(reordered)).toBe(ownerGoalsSaveKey(base));
    expect(ownerGoalsSaveKey({ ...base, goals: { ...goals(), generated_at: '2026-10-22T09:30:00-07:00' } })).not.toBe(ownerGoalsSaveKey(base));
    expect(ownerGoalsSaveKey({ ...base, period: { start: '2026-10-01', end: '2026-11-01' } })).not.toBe(ownerGoalsSaveKey(base));
    // The map path is where the map was left, not what was saved: any spelling of it is the same save.
    expect(ownerGoalsSaveKey({ ...base, mapPath: '/map.md' } as Parameters<typeof ownerGoalsSaveKey>[0])).toBe(ownerGoalsSaveKey(base));
  });
});

describe('appliedSaveKeys', () => {
  it('reads the remembered keys oldest first, falls back to the single save_key of an older save, and is empty with none', () => {
    expect(appliedSaveKeys({ save_keys: 'aaa@100\nbbb@200\nccc@' })).toEqual([{ key: 'aaa', at: 100 }, { key: 'bbb', at: 200 }, { key: 'ccc', at: null }]);
    expect(appliedSaveKeys({ save_key: 'old' })).toEqual([{ key: 'old', at: null }]);
    expect(appliedSaveKeys({ save_key: 'old', save_keys: 'new@5' })).toEqual([{ key: 'new', at: 5 }]);
    expect(appliedSaveKeys(undefined)).toEqual([]);
    expect(appliedSaveKeys({})).toEqual([]);
  });
});

describe('planOwnerGoalsSave', () => {
  it('builds every write with the real ids: the new area\'s row, the state row with its key, one row per area and ask, the rules', () => {
    const planned = plan({ goals: goals(), mapPath: '/owner-map.md' });
    expect(planned.problems).toEqual([]);
    expect(planned.focusAreaIds).toEqual(['fa_000000000000']);
    expect(planned.areaRows).toHaveLength(1);
    expect(planned.areaRows[0]).toMatchObject({ focus_area_id: 'fa_000000000000', name: 'Viewer', status: 'suggested', source: 'owner-goals' });
    expect(planned.rows.map((row) => row.task ?? 'state')).toEqual(['state', 'Focus area: Viewer', 'Ask: Viewer cards']);
    expect(planned.rows[0]).toMatchObject({ status: 'open', map_path: '/owner-map.md', window_days: 31, save_key: planned.saveKey });
    expect(planned.rows[1]).toMatchObject({ goal_kind: 'focus-area', focus_area_id: 'fa_000000000000', status: 'todo', evidence: '2026-10-20 10:00 | keep it live' });
    expect(planned.rows[2]).toMatchObject({ goal_kind: 'ask', focus_area: 'Viewer', focus_area_id: 'fa_000000000000' });
    expect(planned.preferences).toMatchObject([{ preference: 'Carry it through release.', when: 'work is approved', kind: 'directive', supportCount: 1, source: 'owner-goals' }]);
    expect(planned).toMatchObject({ listName: 'owner-goals', history: false, newAreas: 1, droppedPrevious: 0 });
  });

  it('keeps the earlier saves\' keys on the state row with the time of each, newest last, and at most the bound', () => {
    const first = plan({ goals: goals() }, { appliedAt: 100 });
    expect(appliedSaveKeys(first.rows[0])).toEqual([{ key: first.saveKey, at: 100 }]);
    const next = plan({ goals: { ...goals(), generated_at: '2026-10-22T09:30:00-07:00' } }, { appliedAt: 200, previousKeys: appliedSaveKeys(first.rows[0]) });
    expect(appliedSaveKeys(next.rows[0])).toEqual([{ key: first.saveKey, at: 100 }, { key: next.saveKey, at: 200 }]);
    expect(next.rows[0]).toMatchObject({ save_key: next.saveKey });
    // Planned again, a key is kept once; a long history is cut to the newest.
    const again = plan({ goals: goals() }, { appliedAt: 300, previousKeys: appliedSaveKeys(next.rows[0]) });
    expect(appliedSaveKeys(again.rows[0]).map((entry) => entry.key)).toEqual([next.saveKey, first.saveKey]);
    const many = Array.from({ length: 25 }, (_, index) => ({ key: `k${index}`.padEnd(32, '0'), at: index }));
    const cut = appliedSaveKeys(plan({ goals: goals() }, { previousKeys: many }).rows[0]);
    expect(cut).toHaveLength(MAX_REMEMBERED_SAVE_KEYS);
    expect(cut.at(-1)?.key).toBe(first.saveKey);
    expect(cut[0].key).toBe(many[25 - (MAX_REMEMBERED_SAVE_KEYS - 1)].key);
  });

  it('a state row with a full history, a long map path and a long summary still fits: the summary gives way before a remembered key', () => {
    const many = Array.from({ length: MAX_REMEMBERED_SAVE_KEYS }, (_, index) => ({ key: `k${index}`.padEnd(32, '0'), at: 1_700_000_000 + index }));
    const row = plan({ goals: { ...goals(), human_summary: 's'.repeat(1500) }, mapPath: `/${'m'.repeat(400)}/map.md` }, { previousKeys: many }).rows[0];
    expect(JSON.stringify(row).length).toBeLessThanOrEqual(MAX_WORK_STATE_FIELDS_JSON_CHARS);
    expect(appliedSaveKeys(row)).toHaveLength(MAX_REMEMBERED_SAVE_KEYS);
    expect(String(row.human_summary).length).toBeGreaterThan(300);
  });

  it('a matched area keeps its saved id, adds no area, and a rank change is its one row', () => {
    const planned = plan({ goals: { ...goals(), focus_areas: [{ ...goals().focus_areas[0], matches: 'fa_aaaaaaaaaaaa', rank: 1 }] } }, { savedAreas: [saved({})] });
    expect(planned.focusAreaIds).toEqual(['fa_aaaaaaaaaaaa']);
    expect(planned.areaRows).toHaveLength(1);
    expect(planned.areaRows[0]).toMatchObject({ focus_area_id: 'fa_aaaaaaaaaaaa', priority_rank: 1, decided_by: 'system' });
    expect(planned.newAreas).toBe(0);
    expect(planned.rows[1]).toMatchObject({ focus_area_id: 'fa_aaaaaaaaaaaa' });
    expect(plan({ goals: { ...goals(), focus_areas: [{ ...goals().focus_areas[0], matches: 'fa_aaaaaaaaaaaa', rank: 3 }] } }, { savedAreas: [saved({})] }).areaRows).toEqual([]);
  });

  it('marks the open tasks this save no longer has dropped, and keeps the ones it has', () => {
    const planned = plan({ goals: goals() }, { previousTasks: ['Ask: Viewer cards', 'Ask: Gone', 'Focus area: Old'] });
    expect(planned.rows.filter((row) => row.status === 'dropped')).toEqual([{ task: 'Ask: Gone', status: 'dropped' }, { task: 'Focus area: Old', status: 'dropped' }]);
    expect(planned.droppedPrevious).toBe(2);
  });

  it('a past month suggests no area and no rule, and its rows are done and name no area', () => {
    const planned = plan({ goals: goals(), period: { start: '2025-11-01', end: '2025-12-01' } });
    expect(planned).toMatchObject({ history: true, listName: 'owner-goals/2025-11-01', areaRows: [], preferences: [], minedAreas: [], newAreas: 0 });
    expect(planned.rows[0]).toMatchObject({ status: 'done', period_start: '2025-11-01', period_end: '2025-12-01' });
    expect(planned.rows.slice(1).map((row) => [row.status, row.focus_area_id])).toEqual([['done', null], ['done', null]]);
  });

  it('a period that reaches today is the current month', () => {
    expect(plan({ goals: goals(), period: { start: '2026-10-19', end: '2026-11-18' } }).listName).toBe('owner-goals');
    expect(plan({ goals: goals(), period: { start: '2026-10-19', end: '2026-11-17' } }).listName).toBe('owner-goals/2026-10-19');
  });

  it('leaves the oldest quotes off a row that would not fit, newest first, and counts the real id in its size', () => {
    const long = 'w'.repeat(300);
    const evidence = Array.from({ length: 12 }, (_, index) => ({ at: `2026-10-20 10:${String(11 - index).padStart(2, '0')}`, quote: `${long} ${index}` }));
    const planned = plan({ goals: { ...goals(), focus_areas: [{ ...goals().focus_areas[0], evidence }], asks: [], rules: [] } });
    const lines = String(planned.rows[1].evidence).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThan(12);
    expect(lines[0].startsWith('2026-10-20 10:11')).toBe(true);
    expect(JSON.stringify(planned.rows[1]).length).toBeLessThanOrEqual(MAX_WORK_STATE_FIELDS_JSON_CHARS);
    // A quote is cut at 240 characters.
    expect(lines[0].length).toBe('2026-10-20 10:11 | '.length + 240);
  });

  it('cuts a long summary to the room the state row has, and never past 1500 characters', () => {
    const state = (summary: string, mapPath: string | null) => plan({ goals: { ...goals(), human_summary: summary }, mapPath }).rows[0];
    expect(String(state('s'.repeat(5000), null).human_summary)).toHaveLength(1500);
    const tight = state('s'.repeat(1500), `/${'m'.repeat(400)}/map.md`);
    expect(JSON.stringify(tight).length).toBeLessThanOrEqual(MAX_WORK_STATE_FIELDS_JSON_CHARS);
    expect(String(tight.human_summary).length).toBeLessThan(1500);
    // Characters that JSON escapes take more room: the cut still lands under the limit.
    expect(JSON.stringify(state('"\n'.repeat(750), `/${'m'.repeat(400)}/map.md`)).length).toBeLessThanOrEqual(MAX_WORK_STATE_FIELDS_JSON_CHARS);
    expect(state('', null).human_summary).toBeNull();
  });

  it('an area the focus rules refuse is a problem, and the rest of the save is still planned so every problem is found', () => {
    const planned = planOwnerGoalsSave({ goals: { ...goals(), focus_areas: [{ ...goals().focus_areas[0], matches: 'fa_zzzzzzzzzzzz' }] } }, context);
    expect(planned.problems.join()).toContain('fa_zzzzzzzzzzzz, which is not a saved focus area');
    expect('rows' in planned && planned.rows.length).toBe(3);
  });

  it('a goals file that cannot be read as areas, asks and rules is only problems', () => {
    const planned = planOwnerGoalsSave({ goals: { ...goals(), asks: 'not a list' } }, context);
    expect(planned).toEqual({ problems: ['"asks" must be a list of objects'] });
    expect(planOwnerGoalsSave({ goals: goals(), period: { start: '2026-12-01', end: '2026-11-01' } }, context).problems).toEqual(['period: end must be after start']);
  });
});

describe('goalsShapeProblems', () => {
  it('names every problem by item, 1-based', () => {
    expect(goalsShapeProblems({ ...goals(), window_days: true })).toEqual(['"window_days" must be a number']);
    const problems = goalsShapeProblems({
      ...goals(),
      focus_areas: [{ rank: 'one', title: '', goal: 3, matches: '', evidence: [] }],
      asks: [{ title: 'Ask', focus_area: 'Elsewhere', rank: 'x', times_asked: true, evidence: [{ at: 1, quote: 'q' }] }],
      rules: [{ then: ' ', when: 4, evidence: quote('soon', 'q') }],
    });
    const text = problems.join('\n');
    for (const expected of ['focus area 1: needs a "title"', 'focus area 1: "goal" must be text', 'focus area 1: "rank" must be a number',
      'focus area 1: "matches" must be a saved focus area id, or null', 'focus area 1: needs at least one evidence quote', 'ask 1: "focus_area" must be a title',
      'ask 1: "rank" must be a number', 'ask 1: "times_asked" must be a number', 'ask 1: evidence 1 must be', 'rule 1: needs a "then"', 'rule 1: "when" must be text',
      'rule 1: quote time "soon"']) expect(text, expected).toContain(expected);
  });

  it('accepts the file the map step writes, with an ask that names no area and a rule with no when', () => {
    expect(goalsShapeProblems(goals())).toEqual([]);
    expect(goalsShapeProblems({ asks: [{ title: 'Alone', focus_area: null, evidence: quote('2026-10-20 10:00', 'q') }] })).toEqual([]);
    expect(goalsShapeProblems({ rules: [{ then: 'Do it.', evidence: quote('2026-10-20 10:00', 'q') }] })).toEqual([]);
  });
});
