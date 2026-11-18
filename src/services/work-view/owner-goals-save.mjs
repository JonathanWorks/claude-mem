// The whole owner-goals save as one plan, built by the worker from the goals file save_goals.py parsed (POST /api/work-view/owner-goals/save).
// The plan holds every write the save makes, sized with the real focus area ids: the My Focus rows for the new areas, the owner-goals
// rows (list state, one row per area and ask, a dropped row for each earlier item this save no longer has) and the rules for My Rules.
// Nothing here writes. The route validates the plan with the write routes' own schemas, then applies all of it or none of it.
import { createHash } from 'node:crypto';
import { ownerGoalsAreaRows } from './my-focus.mjs';
import { OWNER_GOALS_LIST } from './owner-goals.mjs';
import { MAX_WORK_STATE_FIELDS_JSON_CHARS } from './work-state-limits.mjs';

const KIND_LABELS = { 'focus-area': 'Focus area', ask: 'Ask' };
const MAX_QUOTE_CHARS = 240;
const MAX_SUMMARY_CHARS = 1500;
/** The source a rule carries in the story: the ledger route and writeOwnerGoalsRules accept no other. */
export const OWNER_GOALS_RULE_SOURCE = 'owner-goals';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const QUOTE_MINUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/;

const isText = (value) => typeof value === 'string';
const isCount = (value) => value == null || (typeof value === 'number' && Number.isFinite(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** At most `max` characters (code points), so a clip never splits a surrogate pair. */
const clip = (text, max) => Array.from(text).slice(0, max).join('');
const collapse = (text) => String(text).replace(/\s+/g, ' ').trim();
const itemTitle = (item) => String(item.title ?? '').trim();

/** A quote's local minute as the story keeps it: ISO 8601 with the offset. Null when it is not a minute that exists. */
export function localIsoOf(at) {
  const match = QUOTE_MINUTE.exec(String(at));
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  const offset = -date.getTimezoneOffset();
  const pad = (number) => String(Math.abs(number)).padStart(2, '0');
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${offset < 0 ? '-' : '+'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The key of a save's content: the same goals and period give the same key, so a save whose answer was lost can be sent again and the
 * worker recognizes it. generated_at is part of the goals, so two refreshes never share one;
 * it is recorded data only, and nothing compares it: a save is the same save by its key alone. The map path is where the owner's map was
 * left, not what was saved, so it is not in the key: a relative, an absolute or a symlinked spelling of one file is one save.
 */
export function ownerGoalsSaveKey({ goals, period }) {
  return createHash('sha256').update(canonicalJson({ goals, period: period ?? null })).digest('hex').slice(0, 32);
}

/** How many applied saves a list remembers: enough that a rerun of a recent save is recognized, few enough to leave the state row its room. */
export const MAX_REMEMBERED_SAVE_KEYS = 10;
const KEY_AT_SEPARATOR = '@';

/** The saves a list has applied, oldest first, as `{ key, at }` (at: epoch seconds, or null). Reads save_keys, else the single save_key of an older save. */
export function appliedSaveKeys(fields) {
  const lines = isText(fields?.save_keys) ? fields.save_keys.split('\n').filter(Boolean) : [];
  const entries = lines.map((line) => {
    const [key, at] = line.split(KEY_AT_SEPARATOR);
    return { key, at: Number.isFinite(Number(at)) && at !== undefined && at !== '' ? Number(at) : null };
  });
  if (!entries.length && isText(fields?.save_key) && fields.save_key) entries.push({ key: fields.save_key, at: null });
  return entries;
}

function quoteProblems(label, item) {
  if (!Array.isArray(item.evidence) || !item.evidence.length) return [`${label}: needs at least one evidence quote`];
  return item.evidence.flatMap((quote, index) => (isObject(quote) && isText(quote.at) && isText(quote.quote) ? [] : [`${label}: evidence ${index + 1} must be {"at", "quote"} text`]));
}

/** What keeps the goals from being read as focus areas, asks and rules: every problem, each named by item (1-based). */
export function goalsShapeProblems(goals) {
  const problems = [];
  for (const key of ['generated_at', 'human_summary']) if (goals[key] != null && !isText(goals[key])) problems.push(`"${key}" must be text`);
  for (const key of ['window_days', 'source_prompt_count']) if (!isCount(goals[key])) problems.push(`"${key}" must be a number`);
  const lists = {};
  for (const key of ['focus_areas', 'asks', 'rules']) {
    const items = goals[key] ?? [];
    if (!Array.isArray(items) || !items.every(isObject)) problems.push(`"${key}" must be a list of objects`);
    else lists[key] = items;
  }
  if (problems.length) return problems;
  const areaTitles = (lists.focus_areas ?? []).map(itemTitle);
  (lists.focus_areas ?? []).forEach((area, index) => {
    const label = `focus area ${index + 1}`;
    if (!itemTitle(area) || !isText(area.title)) problems.push(`${label}: needs a "title"`);
    if (!isText(area.goal)) problems.push(`${label}: "goal" must be text`);
    if (typeof area.rank !== 'number') problems.push(`${label}: "rank" must be a number`);
    if (area.matches !== null && !(isText(area.matches) && area.matches.trim())) problems.push(`${label}: "matches" must be a saved focus area id, or null`);
    if (!isCount(area.times_asked)) problems.push(`${label}: "times_asked" must be a number`);
    problems.push(...quoteProblems(label, area));
  });
  (lists.asks ?? []).forEach((ask, index) => {
    const label = `ask ${index + 1}`;
    if (!itemTitle(ask) || !isText(ask.title)) problems.push(`${label}: needs a "title"`);
    if (ask.focus_area !== null && !areaTitles.includes(ask.focus_area)) problems.push(`${label}: "focus_area" must be a title in this save's focus_areas, or null`);
    if (ask.rank != null && typeof ask.rank !== 'number') problems.push(`${label}: "rank" must be a number`);
    if (!isCount(ask.times_asked)) problems.push(`${label}: "times_asked" must be a number`);
    problems.push(...quoteProblems(label, ask));
  });
  (lists.rules ?? []).forEach((rule, index) => {
    const label = `rule ${index + 1}`;
    if (!isText(rule.then) || !rule.then.trim()) problems.push(`${label}: needs a "then"`);
    if (rule.when != null && !isText(rule.when)) problems.push(`${label}: "when" must be text (empty for always)`);
    if (!isCount(rule.times_asked)) problems.push(`${label}: "times_asked" must be a number`);
    problems.push(...quoteProblems(label, rule));
    for (const quote of Array.isArray(rule.evidence) ? rule.evidence : []) {
      if (isObject(quote) && isText(quote.at) && localIsoOf(quote.at) === null) problems.push(`${label}: quote time ${JSON.stringify(quote.at)} is not a local "YYYY-MM-DD HH:MM"`);
    }
  });
  for (const [key, label] of [['focus_areas', 'focus-area'], ['asks', 'ask']]) {
    const titles = (lists[key] ?? []).map(itemTitle);
    for (const title of new Set(titles.filter((title, index) => titles.indexOf(title) !== index))) problems.push(`two ${KIND_LABELS[label].toLowerCase()}s share the title ${JSON.stringify(title)}`);
  }
  return problems;
}

function evidenceLines(item) {
  return item.evidence.map((quote) => `${String(quote.at).slice(0, 16)} | ${clip(collapse(quote.quote), MAX_QUOTE_CHARS)}`);
}

/**
 * One owner-goals row for a focus area or an ask. A row holds at most MAX_WORK_STATE_FIELDS_JSON_CHARS characters as JSON; the newest
 * quotes come first, so the oldest are left off a row that would not fit. The id is the real one, so the row is the size it is written at.
 */
function itemRowFields(kind, item, snapshot, status, focusAreaId) {
  const title = itemTitle(item);
  const evidence = evidenceLines(item);
  const fields = {
    task: `${KIND_LABELS[kind]}: ${title}`, status, goal_kind: kind, rank: item.rank ?? null, title,
    ...(kind === 'focus-area' ? { goal: String(item.goal).trim() } : { focus_area: item.focus_area ?? null }),
    focus_area_id: focusAreaId, latest_at: item.latest_at ?? null, times_asked: item.times_asked ?? null,
    snapshot, evidence: evidence.join('\n'),
  };
  while (JSON.stringify(fields).length > MAX_WORK_STATE_FIELDS_JSON_CHARS && evidence.length > 1) {
    evidence.pop();
    fields.evidence = evidence.join('\n');
  }
  return fields;
}

/** The list state row. The summary is cut to the room the row has left, so a long summary never makes the whole save refused. */
function stateRowFields(goals, { history, period, mapPath, saveKey, previousKeys, appliedAt }) {
  const remembered = [...previousKeys.filter((entry) => entry.key !== saveKey), { key: saveKey, at: appliedAt }].slice(-MAX_REMEMBERED_SAVE_KEYS);
  const base = (keys) => ({
    human_summary: null, generated_at: goals.generated_at || null, window_days: goals.window_days ?? null,
    source_prompt_count: goals.source_prompt_count ?? null, map_path: mapPath ?? null, status: history ? 'done' : 'open',
    ...(period ? { period_start: period.start, period_end: period.end } : {}), save_key: saveKey,
    save_keys: keys.map((entry) => `${entry.key}${KEY_AT_SEPARATOR}${entry.at ?? ''}`).join('\n'),
  });
  const characters = Array.from(String(goals.human_summary ?? '')).slice(0, MAX_SUMMARY_CHARS);
  const fit = (keys) => {
    const withSummary = (count) => ({ ...base(keys), human_summary: count > 0 ? characters.slice(0, count).join('') : null });
    let count = characters.length;
    let row = withSummary(count);
    // Every character is at least one character of JSON, so cutting the overflow is enough; a second pass covers none that were left.
    while (count > 0 && JSON.stringify(row).length > MAX_WORK_STATE_FIELDS_JSON_CHARS) {
      count = Math.max(0, count - (JSON.stringify(row).length - MAX_WORK_STATE_FIELDS_JSON_CHARS));
      row = withSummary(count);
    }
    return row;
  };
  // The summary gives way first; only a row that is still too big with no summary forgets its oldest remembered saves.
  let keys = remembered;
  let row = fit(keys);
  while (JSON.stringify(row).length > MAX_WORK_STATE_FIELDS_JSON_CHARS && keys.length > 1) {
    keys = keys.slice(1);
    row = fit(keys);
  }
  return row;
}

/** One mined focus area as POST /api/work-view/focus/owner-goals takes it. Its quotes stay on the owner-goals row. */
export function minedAreaOf(area) {
  return {
    name: String(area.title).trim(), goal: String(area.goal).trim(), rank: area.rank,
    matches: isText(area.matches) ? area.matches.trim() : null,
    evidence: `From your prompts: asked ${area.times_asked || area.evidence.length} times, latest ${area.latest_at || 'not recorded'}.`,
  };
}

/** One rule as a build-story preference, the input My Rules turns into a suggested rule. */
export function rulePreferenceOf(rule) {
  const times = rule.times_asked;
  return {
    preference: String(rule.then).trim(), when: String(rule.when ?? '').trim(), kind: 'directive',
    supportCount: Number.isInteger(times) && times > 0 ? times : rule.evidence.length,
    quotes: rule.evidence.map((quote) => ({ quote: collapse(quote.quote), at: localIsoOf(quote.at) })),
    source: OWNER_GOALS_RULE_SOURCE,
  };
}

/** The list a save writes and whether it is a past month: a period that ended before `today` (YYYY-MM-DD, the owner's local day). */
export function listOf(period, today) {
  const history = Boolean(period && period.end < today);
  return { history, listName: history ? `${OWNER_GOALS_LIST}/${period.start}` : OWNER_GOALS_LIST };
}

function periodProblems(period) {
  if (!period) return [];
  if (!DAY.test(period.start) || !DAY.test(period.end) || Number.isNaN(Date.parse(period.start)) || Number.isNaN(Date.parse(period.end))) return ['period: start and end must be YYYY-MM-DD days'];
  return period.end > period.start ? [] : ['period: end must be after start'];
}

/**
 * The whole save, planned. `savedAreas` are the focus areas as saved now, `previousTasks` the tasks of this list that are still open
 * now (the ones this save drops when it no longer has them), `today` the owner's local day. Returns `{ problems }` (the goals cannot
 * be planned) or the plan: `{ listName, history, minedAreas, areaRows, focusAreaIds, rows, preferences, droppedPrevious, newAreas,
 * problems }`. `problems` can be non-empty on a plan too: the planning of the areas refused, and the rows then stand in placeholder
 * ids so every problem of the save is found at once. A plan with any problem is never applied.
 * A past month suggests no areas and no rules: those describe the owner now.
 */
export function planOwnerGoalsSave({ goals, period = null, mapPath = null }, { savedAreas, previousTasks, today, newId, previousKeys = [], appliedAt = Math.floor(Date.now() / 1000) }) {
  const problems = [...goalsShapeProblems(goals), ...periodProblems(period)];
  if (problems.length) return { problems };
  const { history, listName } = listOf(period, today);
  const areas = goals.focus_areas ?? [], asks = goals.asks ?? [], rules = goals.rules ?? [];
  const minedAreas = areas.map(minedAreaOf);
  let areaRows = [], focusAreaIds = minedAreas.map((area) => area.matches ?? 'fa_000000000000');
  if (!history) {
    try { ({ rows: areaRows, focusAreaIds } = ownerGoalsAreaRows(minedAreas, savedAreas, newId)); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  const idByTitle = new Map(areas.map((area, index) => [itemTitle(area), history ? null : focusAreaIds[index]]));
  const status = history ? 'done' : 'todo';
  const snapshot = String(goals.generated_at ?? '');
  const itemRows = [
    ...areas.map((area, index) => itemRowFields('focus-area', area, snapshot, status, history ? null : focusAreaIds[index])),
    ...asks.map((ask) => itemRowFields('ask', ask, snapshot, status, idByTitle.get(ask.focus_area) ?? null)),
  ];
  const kept = new Set(itemRows.map((row) => row.task));
  const dropped = previousTasks.filter((task) => !kept.has(task)).map((task) => ({ task, status: 'dropped' }));
  const saveKey = ownerGoalsSaveKey({ goals, period });
  return {
    listName, history, minedAreas: history ? [] : minedAreas, areaRows, focusAreaIds, saveKey,
    rows: [stateRowFields(goals, { history, period, mapPath, saveKey, previousKeys, appliedAt }), ...itemRows, ...dropped],
    preferences: history ? [] : rules.map(rulePreferenceOf),
    droppedPrevious: dropped.length, newAreas: history ? 0 : minedAreas.filter((area) => area.matches === null).length, problems,
  };
}
