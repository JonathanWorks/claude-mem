import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolvePythonCommand } from '../../src/services/work-view/python.js';
import { buildRules } from '../../src/services/work-view/my-rules.mjs';
import { fakeOwnerGoalsWorker, SAVE_PATH } from '../helpers/fake-owner-goals-worker.js';
import { deadPort } from '../helpers/dead-port.js';
import { scratchDir } from '../helpers/scratch-dir.js';

const SKILLS = join(import.meta.dir, '..', '..', 'plugin', 'skills');
const python = await resolvePythonCommand();
const spawnPython = (args: string[], options: { env?: NodeJS.ProcessEnv } = {}) => Bun.spawnSync([python.command, ...python.args, ...args], { ...options, env: { ...process.env, ...options.env, PYTHONUTF8: '1' } });

// Skill scripts run on the user's Python 3, which can be 3.9-3.11.
// Those versions reject a backslash inside an f-string expression; 3.12+ accepts it,
// so on a newer interpreter the tokenizer is used to find the same construct.
const CHECK = String.raw`
import sys, tokenize
path = sys.argv[1]
if sys.version_info < (3, 12):
    compile(open(path, encoding="utf-8").read(), path, "exec")
    sys.exit(0)
depth = 0
with open(path, "rb") as handle:
    for token in tokenize.tokenize(handle.readline):
        if token.type == tokenize.FSTRING_START: depth += 1
        elif token.type == tokenize.FSTRING_END: depth -= 1
        elif depth and token.type != tokenize.FSTRING_MIDDLE and "\\" in token.string:
            print(f"{path}:{token.start[0]}: backslash in an f-string expression")
            sys.exit(1)
`;

function pythonScripts(): string[] {
  return readdirSync(SKILLS, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.py'))
    .map((file) => join(SKILLS, file));
}

describe('skill Python scripts', () => {
  it('finds the scripts to check', () => {
    expect(pythonScripts().some((file) => file.endsWith('save_goals.py'))).toBe(true);
  });

  for (const script of pythonScripts()) {
    it(`parses on Python 3.9-3.11: ${script.slice(SKILLS.length + 1)}`, () => {
      const result = spawnPython(['-c', CHECK, script]);
      expect(result.stdout.toString() + result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
    });
  }
});

// A script run with no worker to answer: the port is one nothing listens on, so a dry run says the worker's check was skipped.
const NO_WORKER = { CLAUDE_MEM_WORKER_PORT: '1', CLAUDE_MEM_WORKER_HOST: '127.0.0.1' };
const SAVE_GOALS = join(SKILLS, 'owner-goals', 'scripts', 'save_goals.py');
const dryRunWithoutWorker = (dir: string, extra: string[] = []) =>
  spawnPython([SAVE_GOALS, '--goals', join(dir, 'goals.json'), '--prompts', join(dir, 'owner-prompts.md'), ...extra, '--dry-run'], { env: NO_WORKER });
/** What a dry run with no worker says it would send. */
const sentGoals = (result: { stdout: { toString(): string } }) => JSON.parse(result.stdout.toString()).request.goals;

describe('save_goals.py', () => {
  it('validates UTF-8 quotes and titles on every platform', () => {
    const dir = mkdtempSync(join(tmpdir(), 'save-goals-utf8-'));
    try {
      writeFileSync(join(dir, 'owner-prompts.md'), '# Owner prompts\n\n## 2026-10-20 10:00 · claude · repo\nsession `a`\n\nİstanbul 🚀\n');
      writeFileSync(join(dir, 'goals.json'), JSON.stringify({ focus_areas: [{ rank: 1, title: 'İstanbul 🚀', goal: 'Gezi.', matches: null, evidence: [{ at: '2026-10-20 10:00', quote: 'İstanbul 🚀' }] }] }));
      const result = dryRunWithoutWorker(dir);
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
      expect(sentGoals(result).focus_areas[0]).toMatchObject({ title: 'İstanbul 🚀', evidence: [{ at: '2026-10-20 10:00', quote: 'İstanbul 🚀' }] });
      expect(JSON.parse(result.stdout.toString()).worker.skipped).toContain('not reachable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('drops quotes that aged out of the prompts window, and items left without one, but still refuses invented quotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'save-goals-'));
    try {
      writeFileSync(join(dir, 'owner-prompts.md'), '# Owner prompts\n\n## 2026-10-20 10:00 · claude · repo\nsession `a`\n\nship the cards today\n');
      const save = (goals: unknown) => {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(goals));
        return dryRunWithoutWorker(dir);
      };
      const result = save({ asks: [
        { rank: 1, title: 'Cards', focus_area: null, evidence: [{ at: '2026-10-20 10:00', quote: 'ship the cards' }, { at: '2026-09-01 09:00', quote: 'aged out' }] },
        { rank: 2, title: 'Old', focus_area: null, evidence: [{ at: '2026-09-02 09:00', quote: 'older words' }] },
      ] });
      expect(result.exitCode).toBe(0);
      expect(sentGoals(result).asks.map((ask: { title: string; evidence: Array<{ quote: string }> }) => [ask.title, ask.evidence.map((quote) => quote.quote)])).toEqual([['Cards', ['ship the cards']]]);
      expect(save({ asks: [{ title: 'Made up', focus_area: null, evidence: [{ at: '2026-10-20 10:00', quote: 'never typed' }] }] }).exitCode).not.toBe(0);
      // Invented quotes are refused on rules and focus areas too.
      expect(save({ rules: [{ when: '', then: 'Ship daily.', evidence: [{ at: '2026-10-20 10:00', quote: 'never typed' }] }] }).exitCode).not.toBe(0);
      expect(save({ focus_areas: [{ title: 'Cards', goal: 'The cards.', matches: null, evidence: [{ at: '2026-10-20 10:00', quote: 'never typed' }] }] }).exitCode).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts a quote under 3 characters when it is a whole word of the prompt (Oct 26: "hi" failed every refresh)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'save-goals-short-'));
    try {
      const save = (prompt: string, quote: string) => {
        writeFileSync(join(dir, 'owner-prompts.md'), `# Owner prompts\n\n## 2026-10-25 16:13 · codex · yiddish-ai-kit\nsession \`01a174b2\`\n\n${prompt}\n`);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ focus_areas: [{ rank: 1, title: 'Greeting only', goal: 'Say hello.', matches: null, evidence: [{ at: '2026-10-25 16:13', quote }] }] }));
        return dryRunWithoutWorker(dir);
      };
      expect(save('hi', 'hi').exitCode).toBe(0);
      expect(save('ok, go', 'ok').exitCode).toBe(0);
      // Still a whole word, never part of one, and still refused when it was not typed.
      expect(save('this works', 'hi').exitCode).not.toBe(0);
      expect(save('hi', 'ok').exitCode).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('clears the goals when every saved quote has aged out, instead of refusing to save forever', () => {
    const dir = mkdtempSync(join(tmpdir(), 'save-goals-'));
    try {
      const save = (prompts: string, goals: unknown) => {
        writeFileSync(join(dir, 'owner-prompts.md'), prompts);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(goals));
        return dryRunWithoutWorker(dir);
      };
      const aged = { generated_at: '2026-10-20T10:00:00Z', focus_areas: [{ rank: 1, title: 'Old', goal: 'Old work.', matches: null, evidence: [{ at: '2026-09-02 09:00', quote: 'older words' }] }] };
      // Newer prompts exist, but none was quoted: the saved goal's only quote is older than the window.
      const later = save('# Owner prompts\n\n## 2026-10-20 10:00 · claude · repo\nsession `a`\n\nunrelated words\n', aged);
      expect(later.stderr.toString()).toBe('');
      expect(later.exitCode).toBe(0);
      expect(sentGoals(later)).toMatchObject({ generated_at: '2026-10-20T10:00:00Z', focus_areas: [], asks: [], rules: [] });
      // No prompts in the window at all: every quote is outside it.
      expect(save('# Owner prompts\n', aged).exitCode).toBe(0);
      expect(save('# Owner prompts\n', { focus_areas: [], asks: [], rules: [] }).exitCode).toBe(0);
      // An answer with no goals at all, while prompts exist, is still refused.
      expect(save('# Owner prompts\n\n## 2026-10-20 10:00 · claude · repo\nsession `a`\n\nunrelated words\n', { focus_areas: [], asks: [], rules: [] }).exitCode).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('drops a carried-forward quote that no longer matches, but still refuses a new one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'save-goals-'));
    try {
      writeFileSync(join(dir, 'owner-prompts.md'), '# Owner prompts\n\n## 2026-10-20 10:00 · claude · repo\nsession `a`\n\nship the cards  today\n\n---\n\n## 2026-10-21 09:00 · claude · repo\nsession `a`\n\nfix the login\n');
      const save = (goals: unknown) => {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(goals));
        return dryRunWithoutWorker(dir, ['--carried-before', '2026-10-21 00:00']);
      };
      // Saved before the export stripped <private>: the quote held the private words.
      const result = save({ asks: [
        { rank: 1, title: 'Cards', focus_area: null, evidence: [{ at: '2026-10-20 10:00', quote: 'ship the cards key sk-123 today' }] },
        { rank: 2, title: 'Login', focus_area: null, evidence: [{ at: '2026-10-21 09:00', quote: 'fix the login' }] },
      ] });
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
      expect(sentGoals(result).asks.map((ask: { title: string }) => ask.title)).toEqual(['Login']);
      expect(save({ asks: [{ title: 'Made up', focus_area: null, evidence: [{ at: '2026-10-21 09:00', quote: 'never typed' }] }] }).exitCode).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('save_goals.py: focus areas, asks and rules', () => {
  const PROMPTS = '# Owner prompts\n\n## 2026-10-20 10:00 · claude · repo\nsession `a`\n\nship the viewer cards and keep it live\n\n---\n\n## 2026-10-21 09:00 · claude · repo\nsession `a`\n\nnever make me publish anything myself\n';
  const quote = (at: string, words: string) => [{ at, quote: words }];
  const answer = {
    generated_at: '2026-10-21T09:30:00-07:00', human_summary: 'Viewer work.',
    focus_areas: [{ rank: 1, title: 'Viewer', goal: 'A live view of my work.', matches: null, latest_at: '2026-10-20 10:00', times_asked: 2, evidence: quote('2026-10-20 10:00', 'keep it live') }],
    asks: [{ rank: 1, title: 'Viewer cards', focus_area: 'Viewer', latest_at: '2026-10-20 10:00', times_asked: 1, evidence: quote('2026-10-20 10:00', 'ship the viewer cards') }],
    rules: [{ when: 'work is approved', then: 'Carry it through release without the owner publishing.', latest_at: '2026-10-21 09:00', times_asked: 1, evidence: quote('2026-10-21 09:00', 'never make me publish anything myself') }],
  };
  const withDir = async (work: (dir: string) => Promise<void> | void) => {
    const dir = scratchDir('save-goals-kinds');
    try { writeFileSync(join(dir, 'owner-prompts.md'), PROMPTS); await work(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const saveArgs = (dir: string, ...extra: string[]) => ['--goals', join(dir, 'goals.json'), '--prompts', join(dir, 'owner-prompts.md'), ...extra];
  const owner = (worker: { state(): any }) => (worker.state().lists.find((list: { name: string }) => list.name === 'owner-goals')?.tasks ?? []) as Array<{ name: string; fields: Record<string, unknown> }>;
  const goalRows = (worker: { rows(): Array<{ list_name: string }> }) => worker.rows().filter((row) => row.list_name.startsWith('owner-goals'));
  const storyOf = (ledgerDir: string) => JSON.parse(readFileSync(join(ledgerDir, 'story.json'), 'utf8'));

  it('a dry run asks the worker to plan the save and writes nothing: the rows it would write, built with the worker\'s own shapes', () => withDir(async (dir) => {
    const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
    try {
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
      const result = await worker.run(saveArgs(dir, '--dry-run'));
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.worker.writes.slice(1).map((write: Record<string, unknown>) => [write.task, write.goal_kind])).toEqual([['Focus area: Viewer', 'focus-area'], ['Ask: Viewer cards', 'ask']]);
      expect(output.worker.writes[1]).toMatchObject({ goal: 'A live view of my work.', evidence: '2026-10-20 10:00 | keep it live' });
      expect(output.worker.writes[2]).toMatchObject({ focus_area: 'Viewer' });
      expect(output.worker.focusAreas).toEqual([{ name: 'Viewer', goal: 'A live view of my work.', rank: 1, matches: null, evidence: 'From your prompts: asked 2 times, latest 2026-10-20 10:00.' }]);
      expect(output.worker.rules).toMatchObject([{ preference: 'Carry it through release without the owner publishing.', when: 'work is approved', source: 'owner-goals', quotes: [{ quote: 'never make me publish anything myself' }] }]);
      // EXECUTION: the worker's save route was entered with the dry-run flag, and nothing was written or even begun.
      expect(worker.saveBodies).toHaveLength(1);
      expect(worker.saveBodies[0].dryRun).toBe(true);
      expect(worker.atomicSaves.entered).toBe(0);
      expect(worker.rows()).toEqual([]);
    } finally { await worker.stop(); }
  }));

  it('refuses the old priorities shape, an area without matches or goal, and an ask under an area the answer does not have', () => withDir((dir) => {
    const refused = (goals: unknown, reason: string) => {
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(goals));
      const result = dryRunWithoutWorker(dir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(reason);
    };
    refused({ priorities: answer.focus_areas, open_asks: [] }, 'the old shape');
    refused({ ...answer, focus_areas: [{ ...answer.focus_areas[0], matches: undefined }] }, '"matches" must be');
    refused({ ...answer, focus_areas: [{ ...answer.focus_areas[0], goal: '' }] }, 'one-sentence "goal"');
    refused({ ...answer, asks: [{ ...answer.asks[0], focus_area: 'Releases' }] }, "focus_area 'Releases' is not a title");
    refused({ ...answer, focus_areas: [{ ...answer.focus_areas[0], rank: true }] }, '"rank" must be a whole number');
  }));

  it('saves in ONE call: a new area as a My Focus suggestion, asks under its id, and rules as My Rules suggestions beside the story\'s own', () => withDir(async (dir) => {
    const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
    try {
      const storyOwn = { preference: 'Keep the existing design.', kind: 'directive', supportCount: 2, quotes: [] };
      writeFileSync(join(worker.ledgerDir, 'story.json'), JSON.stringify({ narrative: 'The story.', writtenAt: '2026-10-20T00:00:00Z', preferences: [storyOwn, { preference: 'An old owner-goals rule.', source: 'owner-goals', quotes: [] }] }));
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
      const result = await worker.run(saveArgs(dir, '--ledger-dir', worker.ledgerDir));
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      // EXECUTION: exactly one write request reached the worker, and its store ran it as one transaction that committed.
      expect(worker.requests.filter((request) => request.startsWith('POST'))).toEqual([`POST ${SAVE_PATH}`]);
      expect(worker.atomicSaves).toEqual({ entered: 1, rowsInserted: 4, committed: 1 });
      const [area] = worker.focusAreas();
      expect(area).toMatchObject({ name: 'Viewer', goal: 'A live view of my work.', status: 'suggested', source: 'owner-goals', decidedBy: 'system', priorityRank: 1 });
      expect(area.focusAreaId).toMatch(/^fa_[0-9a-f]{12}$/);
      expect(owner(worker).map((task) => [task.name, task.fields.goal_kind, task.fields.focus_area_id]))
        .toEqual([['Focus area: Viewer', 'focus-area', area.focusAreaId], ['Ask: Viewer cards', 'ask', area.focusAreaId]]);
      expect(JSON.parse(result.stdout)).toMatchObject({ saved_focus_areas: 1, saved_asks: 1, saved_rules: 1, new_focus_areas: 1, dropped_previous_items: 0, already_applied: false, list: 'owner-goals', history: false, rules_file: join(worker.ledgerDir, 'story.json') });
      const story = storyOf(worker.ledgerDir);
      expect(story.narrative).toBe('The story.');
      expect(story.preferences.map((preference: { preference: string }) => preference.preference)).toEqual(['Keep the existing design.', 'Carry it through release without the owner publishing.']);
      // My Rules shows it as a suggested rule with its own when.
      const rules = buildRules({ lists: [] }, { story, progress: {} }).rules;
      expect(rules.find((rule: { then: string }) => rule.then.startsWith('Carry'))).toMatchObject({ when: 'work is approved', status: 'suggested', setBy: 'learned', source: 'owner-goals' });
      // The quote's minute is kept as a local time with its offset.
      expect(story.preferences[1].quotes[0].at).toMatch(/^2026-10-21T09:00:00[+-]\d\d:\d\d$/);
    } finally { await worker.stop(); }
  }));

  it('an unknown match is refused by the worker before anything is written: exit 1, no row, no transaction begun', () => withDir(async (dir) => {
    const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
    try {
      writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, focus_areas: [{ ...answer.focus_areas[0], matches: 'fa_000000000000' }] }));
      const result = await worker.run(saveArgs(dir, '--ledger-dir', worker.ledgerDir));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not a saved focus area');
      expect(result.stderr).toContain('Nothing was written');
      // EXECUTION: the worker's save route was entered, and refused it before its store was.
      expect(worker.saveBodies).toHaveLength(1);
      expect(worker.atomicSaves.entered).toBe(0);
      expect(worker.rows()).toEqual([]);
      expect(existsSync(join(worker.ledgerDir, 'story.json'))).toBe(false);
    } finally { await worker.stop(); }
  }));

  it('a store that fails on the second row rolls back the first: exit 1, nothing written, and the message says so', () => withDir(async (dir) => {
    const worker = await fakeOwnerGoalsWorker(join(dir, 'data'), { failAtRow: 2 });
    try {
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
      const result = await worker.run(saveArgs(dir));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('injected store fault before row 2');
      expect(result.stderr).toContain('nothing was written');
      expect(result.stderr).toContain('Nothing was written');
      expect(result.stderr).not.toContain('Do not run this again');
      // EXECUTION: the transaction was entered, the first row was inserted, and the fault came after it, so SQLite had a row to roll back.
      expect(worker.atomicSaves).toEqual({ entered: 1, rowsInserted: 1, committed: 0 });
      expect(worker.rows()).toEqual([]);
      expect(existsSync(join(worker.ledgerDir, 'story.json'))).toBe(false);
    } finally { await worker.stop(); }
  }));

  describe('the rules are written by the worker, never by the script', () => {
    const OWN = { preference: 'Keep the existing design.', kind: 'directive', supportCount: 2, quotes: [] };
    const seedStory = (ledgerDir: string) => {
      mkdirSync(ledgerDir, { recursive: true });
      writeFileSync(join(ledgerDir, 'story.json'), JSON.stringify({ narrative: 'The story.', preferences: [OWN, { preference: 'An old owner-goals rule.', source: 'owner-goals', quotes: [] }] }));
      return readFileSync(join(ledgerDir, 'story.json'), 'utf8');
    };

    it('a worker with no save route (an older worker) refuses: exit 1, nothing written, story.json untouched, the route named', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'), { noSaveRoute: true });
      try {
        const before = seedStory(worker.ledgerDir);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir, '--ledger-dir', worker.ledgerDir));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(SAVE_PATH);
        expect(result.stderr).toContain('update claude-mem');
        expect(result.stderr).toContain('Nothing was written');
        expect(readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8')).toBe(before);
        expect(worker.saveBodies).toHaveLength(1);
        expect(worker.rows()).toEqual([]);
      } finally { await worker.stop(); }
    }));

    it('a dry run against a worker that predates the save route skips the worker\'s check instead of failing', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'), { noSaveRoute: true });
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir, '--dry-run'));
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).worker.skipped).toContain('404');
        expect(worker.saveBodies).toHaveLength(1);
        expect(worker.rows()).toEqual([]);
      } finally { await worker.stop(); }
    }));

    it('a worker that writes another ledger folder refuses before anything is written: exit 1, neither story.json touched', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        const before = seedStory(worker.ledgerDir);
        const wanted = join(dir, 'ledger');
        const wantedBefore = seedStory(wanted);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir, '--ledger-dir', wanted));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('This worker writes the request ledger in');
        expect(result.stderr).toContain('Nothing was written');
        // EXECUTION: the worker's save route was entered with the folder named, and its store never was.
        expect(worker.saveBodies).toHaveLength(1);
        expect(worker.saveBodies[0].ledgerDir).toBe(resolve(wanted));
        expect(worker.atomicSaves.entered).toBe(0);
        expect(worker.rows()).toEqual([]);
        expect(readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8')).toBe(before);
        expect(readFileSync(join(wanted, 'story.json'), 'utf8')).toBe(wantedBefore);
      } finally { await worker.stop(); }
    }));

    it('with no worker running it refuses before writing anything: exit 1, no story.json', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir), { workerPort: await deadPort() });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('not reachable');
        // A failure before the request is sent says nothing was written, never that the worker may have applied it.
        expect(result.stderr).toContain('Nothing was written');
        expect(result.stderr).not.toContain('may or may not');
        expect(existsSync(join(worker.ledgerDir, 'story.json'))).toBe(false);
        expect(worker.requests).toEqual([]);
        expect(worker.rows()).toEqual([]);
      } finally { await worker.stop(); }
    }));

    it('an answer with no rules still clears the old owner-goals rules; a past month leaves the story alone', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        seedStory(worker.ledgerDir);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, rules: [] }));
        expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
        expect(storyOf(worker.ledgerDir).preferences).toEqual([OWN]);

        // A month that ended before today describes the owner then: no rules, so the story is not written.
        const bytes = readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8');
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const history = await worker.run(saveArgs(dir, '--start', '2025-11-01', '--end', '2025-12-01'));
        expect(history.exitCode).toBe(0);
        expect(JSON.parse(history.stdout)).toMatchObject({ history: true, list: 'owner-goals/2025-11-01', saved_rules: 0, rules_file: null, rules_not_saved_for_past_month: 1 });
        expect(readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8')).toBe(bytes);
      } finally { await worker.stop(); }
    }));

    it('a story.json that cannot be written rolls every row back: exit 1, nothing written, no area suggested', () => withDir(async (dir) => {
      if (process.getuid?.() === 0) return;
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        // A ledger folder nobody can write in: the finished story cannot be created, after every row was inserted.
        chmodSync(worker.ledgerDir, 0o500);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('nothing was written');
        expect(worker.atomicSaves).toEqual({ entered: 1, rowsInserted: 4, committed: 0 });
        expect(worker.rows()).toEqual([]);
        expect(worker.focusAreas()).toEqual([]);
      } finally { chmodSync(worker.ledgerDir, 0o700); await worker.stop(); }
    }));

    it('save_goals.py has no write of story.json of its own left in it', () => {
      const source = readFileSync(SAVE_GOALS, 'utf8');
      expect(source).not.toMatch(/os\.replace|write_json_atomic|open\([^)]*,\s*"w"/);
    });
  });

  it('a match is the model\'s judgment: a saved id adds no area, and an id that is not saved is refused', () => withDir(async (dir) => {
    const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
    try {
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
      const args = saveArgs(dir, '--ledger-dir', worker.ledgerDir);
      expect((await worker.run(args)).exitCode).toBe(0);
      const [saved] = worker.focusAreas();
      worker.ownerDecides(saved, { name: 'My viewer', status: 'kept' });
      writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, focus_areas: [{ ...answer.focus_areas[0], title: 'Live viewer', matches: saved.focusAreaId, rank: 3 }], asks: [{ ...answer.asks[0], focus_area: 'Live viewer' }] }));
      expect((await worker.run(args)).exitCode).toBe(0);
      expect(worker.focusAreas()).toEqual([expect.objectContaining({ focusAreaId: saved.focusAreaId, name: 'My viewer', status: 'kept', priorityRank: 1 })]);
      writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, focus_areas: [{ ...answer.focus_areas[0], matches: 'fa_000000000000' }] }));
      const refused = await worker.run(args);
      expect(refused.exitCode).not.toBe(0);
      expect(refused.stderr).toContain('fa_000000000000, which is not a saved focus area');
    } finally { await worker.stop(); }
  }));

  it('a matched area whose rank changes is written in the same transaction as its rows, and rolled back with them', () => withDir(async (dir) => {
    const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
    try {
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
      expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
      const [saved] = worker.focusAreas();
      const rowsBefore = worker.rows();
      const storyBefore = readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8');
      const next = { ...answer, generated_at: '2026-10-22T09:30:00-07:00', focus_areas: [{ ...answer.focus_areas[0], matches: saved.focusAreaId, rank: 4 }] };
      writeFileSync(join(dir, 'goals.json'), JSON.stringify(next));
      // The matched area's rank row is the first row of this save; the fault comes on the next one, after the rank row was inserted.
      worker.setFailAtRow(2);
      const failed = await worker.run(saveArgs(dir));
      expect(failed.exitCode).toBe(1);
      expect(failed.stderr).toContain('nothing was written');
      // EXECUTION: the second save entered the store and inserted the rank row; SQLite rolled it back with the rest.
      expect(worker.atomicSaves).toEqual({ entered: 2, rowsInserted: 5, committed: 1 });
      expect(worker.rows()).toEqual(rowsBefore);
      expect(worker.focusAreas()[0]).toMatchObject({ focusAreaId: saved.focusAreaId, priorityRank: 1 });
      expect(readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8')).toBe(storyBefore);

      // The same save, once the store works, applies the rank change with its rows.
      worker.setFailAtRow(null);
      expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
      expect(worker.focusAreas()[0]).toMatchObject({ focusAreaId: saved.focusAreaId, priorityRank: 4 });
      expect(worker.focusAreas()).toHaveLength(1);
    } finally { await worker.stop(); }
  }));

  describe('a whole-number field is a number in the file', () => {
    it('refuses true for a whole-number field (times_asked, window_days) before the worker is asked anything', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        for (const [goals, field] of [
          [{ ...answer, rules: [{ ...answer.rules[0], times_asked: true }] }, 'times_asked'],
          [{ ...answer, asks: [{ ...answer.asks[0], times_asked: true }] }, 'times_asked'],
          [{ ...answer, focus_areas: [{ ...answer.focus_areas[0], times_asked: true }] }, 'times_asked'],
          [{ ...answer, window_days: true }, 'window_days'],
        ] as const) {
          writeFileSync(join(dir, 'goals.json'), JSON.stringify(goals));
          const result = await worker.run(saveArgs(dir));
          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain(field);
          expect(worker.requests).toEqual([]);
        }
      } finally { await worker.stop(); }
    }));

    it('a time the file does not hold as a whole number (a 1.5) is the worker\'s to judge, not the script\'s', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, asks: [{ ...answer.asks[0], times_asked: 1.5 }] }));
        const result = await worker.run(saveArgs(dir));
        expect(result.exitCode).toBe(0);
        expect(worker.saveBodies).toHaveLength(1);
      } finally { await worker.stop(); }
    }));
  });

  describe('against the real WorkViewRoutes: the worker alone says what is acceptable', () => {
    const EMOJI = '\u{1F680}';
    const area = (overrides: Record<string, unknown> = {}) => ({ ...answer.focus_areas[0], ...overrides });
    const rule = (then: string, extra: Record<string, unknown> = {}) => ({ ...answer.rules[0], then, ...extra });
    const goalsWith = (overrides: Record<string, unknown>) => ({ ...answer, ...overrides });

    it('a valid payload is saved in full by one request: areas, rows and rules, rules at the 200-unit limit', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        const rules = [
          { ...answer.rules[0], then: 'Carry it through release without the owner publishing.', times_asked: 3 },
          { ...answer.rules[0], then: 'é'.repeat(200), when: 'l’été' },
          { ...answer.rules[0], then: EMOJI.repeat(100), times_asked: 0 },
        ];
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, rules }));
        const result = await worker.run(saveArgs(dir, '--ledger-dir', worker.ledgerDir));
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
        // EXECUTION: the store committed once, with the area and the three owner-goals rows.
        expect(worker.atomicSaves).toEqual({ entered: 1, rowsInserted: 4, committed: 1 });
        expect(worker.focusAreas()).toHaveLength(1);
        expect(goalRows(worker)).toHaveLength(3);
        const story = storyOf(worker.ledgerDir);
        expect(story.preferences.map((preference: { preference: string }) => preference.preference)).toEqual(rules.map((entry) => entry.then));
        expect(story.preferences.map((preference: { supportCount: number }) => preference.supportCount)).toEqual([3, 1, 1]);
        expect(story.preferences[1].when).toBe('l’été');
      } finally { await worker.stop(); }
    }));

    const REFUSED: Array<[string, Record<string, unknown>, string]> = [
      ['a rule of 101 emoji (202 UTF-16 units)', goalsWith({ rules: [rule(EMOJI.repeat(101))] }), 'UTF-16'],
      ['a rule of 201 ASCII characters', goalsWith({ rules: [rule('a'.repeat(201))] }), 'UTF-16'],
      ['an area name of 81 characters', goalsWith({ focus_areas: [area({ title: 'a'.repeat(81) })], asks: [] }), 'name'],
      ['an area name of 81 emoji', goalsWith({ focus_areas: [area({ title: EMOJI.repeat(81) })], asks: [] }), 'name'],
      ['an area goal of 301 characters', goalsWith({ focus_areas: [area({ goal: 'g'.repeat(301) })], asks: [] }), 'goal'],
      ['an area evidence line over 300 characters', goalsWith({ focus_areas: [area({ latest_at: 'y'.repeat(300) })] }), 'evidence'],
      ['an integer above 2^53-1 in an ask', goalsWith({ asks: [{ ...answer.asks[0], times_asked: 2 ** 53 }] }), 'safe'],
      ['an integer above 2^53-1 in the list state', goalsWith({ window_days: 2 ** 53 }), 'safe'],
      ['a rank of 0', goalsWith({ focus_areas: [area({ rank: 0 })] }), 'rank'],
    ];
    for (const [name, goals, reason] of REFUSED) {
      it(`${name}: the worker refuses it, and nothing is written`, () => withDir(async (dir) => {
        const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
        try {
          writeFileSync(join(dir, 'goals.json'), JSON.stringify(goals));
          const result = await worker.run(saveArgs(dir, '--ledger-dir', worker.ledgerDir));
          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain('the worker refused this save');
          expect(result.stderr).toContain(reason);
          expect(result.stderr).toContain('Nothing was written');
          // EXECUTION: the worker's save route was entered and said no; its store was never entered.
          expect(worker.saveBodies).toHaveLength(1);
          expect(worker.atomicSaves.entered).toBe(0);
          expect(worker.rows()).toEqual([]);
          expect(existsSync(join(worker.ledgerDir, 'story.json'))).toBe(false);
        } finally { await worker.stop(); }
      }));
    }

    it('every problem is answered at once, not the first', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(goalsWith({ focus_areas: [area({ title: 'a'.repeat(81) })], asks: [], rules: [rule('r'.repeat(201))] })));
        const result = await worker.run(saveArgs(dir));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('focus area 1');
        expect(result.stderr).toContain('rule 1');
      } finally { await worker.stop(); }
    }));

    it('an area name is held to the worker\'s own line, counted as zod counts it: 40 and 80 emoji pass, 81 do not', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        for (const [count, exitCode] of [[40, 0], [80, 0], [81, 1]] as const) {
          writeFileSync(join(dir, 'goals.json'), JSON.stringify(goalsWith({ focus_areas: [area({ title: EMOJI.repeat(count) })], asks: [] })));
          const result = await worker.run(saveArgs(dir));
          expect(result.exitCode, `${count} emoji`).toBe(exitCode);
        }
        expect(worker.focusAreas().map((saved) => saved.name)).toEqual([EMOJI.repeat(40), EMOJI.repeat(80)]);
      } finally { await worker.stop(); }
    }));

    it('a row too large for its limit is shaped with the real area id: the oldest quotes are left off, and the row is saved', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        const long = 'w'.repeat(230);
        const minutes = Array.from({ length: 9 }, (_, index) => `2026-10-20 10:0${index}`);
        const prompts = minutes.map((at) => `## ${at} · claude · repo\nsession \`a\`\n\n${long} ${at}\n`);
        writeFileSync(join(dir, 'owner-prompts.md'), `# Owner prompts\n\n${prompts.join('\n---\n\n')}`);
        const evidence = [...minutes].reverse().map((at) => ({ at, quote: `${long} ${at}` }));
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(goalsWith({ focus_areas: [area({ evidence })], asks: [], rules: [] })));
        const result = await worker.run(saveArgs(dir));
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
        const row = owner(worker)[0].fields;
        const lines = String(row.evidence).split('\n');
        // The newest quote is kept, the oldest are the ones left off, and the row is at the stored limit.
        expect(lines.length).toBeGreaterThan(4);
        expect(lines.length).toBeLessThan(9);
        expect(lines[0].startsWith('2026-10-20 10:08')).toBe(true);
        expect(JSON.stringify(row).length).toBeLessThanOrEqual(2000);
      } finally { await worker.stop(); }
    }));

    it('a past month is saved as history: rows done under owner-goals/<start>, no My Focus area, no ledger folder asked, no rules written', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir, '--start', '2025-11-01', '--end', '2025-12-01'));
        expect(result.exitCode).toBe(0);
        expect(worker.saveBodies[0].period).toEqual({ start: '2025-11-01', end: '2025-12-01' });
        expect(worker.saveBodies[0].ledgerDir).toBeUndefined();
        expect(worker.focusAreas()).toEqual([]);
        const rows = worker.rows().map((row) => ({ list: row.list_name, fields: JSON.parse(row.fields) }));
        expect(rows.every((row) => row.list === 'owner-goals/2025-11-01')).toBe(true);
        expect(rows[0].fields).toMatchObject({ status: 'done', period_start: '2025-11-01', period_end: '2025-12-01' });
        expect(rows.slice(1).every((row) => row.fields.status === 'done' && row.fields.focus_area_id === null)).toBe(true);
        expect(existsSync(join(worker.ledgerDir, 'story.json'))).toBe(false);
      } finally { await worker.stop(); }
    }));
  });

  describe('the ledger folder and the worker\'s address', () => {
    const PATHS = join(import.meta.dir, '..', '..', 'src', 'shared', 'paths.ts');
    const HARNESS = join(import.meta.dir, '..', '..', 'src', 'integrations', 'harness-worker.ts');
    const SCRIPTS = join(SKILLS, 'owner-goals', 'scripts');
    /** What the worker's resolveDataDir answers under this environment (a process of its own: it reads the environment at call time). */
    const workersDataDir = (env: Record<string, string>) => {
      const result = Bun.spawnSync([process.execPath, '-e', `import { resolveDataDir } from ${JSON.stringify(PATHS)}; console.log(resolveDataDir())`], { env: { ...process.env, ...env } });
      expect(result.exitCode).toBe(0);
      return result.stdout.toString().trim();
    };

    // Each case: the environment's data folder value, and the settings.json at the home folder's default (null: none).
    const CASES: Array<[string, string | null, (data: string) => string | null]> = [
      ['the data folder only in settings.json', null, (data) => JSON.stringify({ CLAUDE_MEM_DATA_DIR: data })],
      ['the data folder only in settings.json, wrapped in env', null, (data) => JSON.stringify({ env: { CLAUDE_MEM_DATA_DIR: data, CLAUDE_MEM_WORKER_PORT: '1' } })],
      ['CLAUDE_MEM_DATA_DIR=~/x', '~/x', () => null],
      ['CLAUDE_MEM_DATA_DIR=~//x', '~//x', () => null],
    ];
    for (const [name, envValue, settingsFor] of CASES) {
      it(`${name}: the rules go to the folder the worker serves, and the script names none`, () => withDir(async (dir) => {
        const home = join(dir, 'home');
        const wanted = envValue === null ? join(dir, 'relocated') : join(home, 'x');
        const settings = settingsFor(wanted);
        mkdirSync(join(home, '.claude-mem'), { recursive: true });
        if (settings !== null) writeFileSync(join(home, '.claude-mem', 'settings.json'), settings);
        const env = { HOME: home, CLAUDE_MEM_DATA_DIR: envValue ?? '' };
        // The worker's own resolveDataDir, run under the same environment, is the folder the worker serves; it is not the default.
        expect(workersDataDir(env)).toBe(wanted);
        const worker = await fakeOwnerGoalsWorker(join(dir, 'unused-data'), { ledgerDir: join(wanted, 'work-view') });
        try {
          writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
          const result = await worker.run(saveArgs(dir), { env: { HOME: home, CLAUDE_MEM_DATA_DIR: envValue } });
          expect(result.stderr).toBe('');
          expect(result.exitCode).toBe(0);
          // EXECUTION: the worker wrote the rules in its own folder, and the request named no folder at all.
          expect(worker.saveBodies.map((body) => body.ledgerDir)).toEqual([undefined]);
          expect(existsSync(join(wanted, 'work-view', 'story.json'))).toBe(true);
        } finally { await worker.stop(); }
      }));
    }

    it('finds the worker the way the harness client does: the same address from CLAUDE_MEM_DATA_DIR flat, wrapped, with ~//x, and with none', () => withDir((dir) => {
      const cases: Array<[string, string, string | null]> = [
        ['env ~/x, flat', '~/x', JSON.stringify({ CLAUDE_MEM_WORKER_PORT: '41001' })],
        ['env ~//x', '~//x', JSON.stringify({ CLAUDE_MEM_WORKER_PORT: '41002', CLAUDE_MEM_WORKER_HOST: '127.0.0.2' })],
        ['env ~/x, wrapped in env', '~/x', JSON.stringify({ env: { CLAUDE_MEM_WORKER_PORT: '41003' } })],
        ['no env: settings in ~/.claude-mem', '', JSON.stringify({ CLAUDE_MEM_WORKER_PORT: '41004' })],
      ];
      cases.forEach(([name, envValue, settings], index) => {
        const home = join(dir, `home-${index}`);
        const folder = envValue === '' ? join(home, '.claude-mem') : join(home, 'x');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'settings.json'), settings!);
        const env = { HOME: home, CLAUDE_MEM_DATA_DIR: envValue, CLAUDE_MEM_WORKER_PORT: '', CLAUDE_MEM_WORKER_HOST: '' };
        const fromHarness = Bun.spawnSync([process.execPath, '-e', `import { resolveHarnessWorkerUrl } from ${JSON.stringify(HARNESS)}; console.log(resolveHarnessWorkerUrl())`], { env: { ...process.env, ...env } });
        expect(fromHarness.exitCode, name).toBe(0);
        const fromScript = spawnPython(['-c', `import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import save_goals; print(save_goals.worker_base_url())`], { env });
        expect(fromScript.exitCode, name).toBe(0);
        expect(fromScript.stdout.toString().trim(), name).toBe(fromHarness.stdout.toString().trim());
        // Not the default port: the case's settings file was read.
        expect(fromScript.stdout.toString(), name).toContain(`:4100${index + 1}`);
      });
    }));

    it('save_goals.py works no data folder out and builds no row: no data_dir, no ~/.claude-mem joined to a ledger or database, no row limit or builder of its own', () => {
      const source = readFileSync(join(SCRIPTS, 'save_goals.py'), 'utf8');
      expect(source).not.toMatch(/def data_dir|["']work-view["']|claude-mem\.db/);
      expect(source).not.toMatch(/MAX_FIELDS_JSON_CHARS|MAX_QUOTE_CHARS|def item_fields|def mined_area|def rule_preference|\/api\/work-view\/(ledger|focus|owner-goals\/check)|\/api\/work-state/);
    });
  });

  describe('one call, two outcomes: applied, or not applied with every problem listed; a lost answer is safe to run again', () => {
    const SHORT_TIMEOUT = { CLAUDE_MEM_WORKER_TIMEOUT_SECONDS: '1' };

    it('before the request is sent: nothing was written, and the message says so (exit 1)', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir), { workerPort: await deadPort() });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('not reachable');
        expect(result.stderr).toContain('Nothing was written');
        expect(worker.requests).toEqual([]);
      } finally { await worker.stop(); }
    }));

    it('a timeout after the request was sent says the worker may have applied it, and that running the same command again is safe (exit 3)', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'), { saveBehavior: 'hang' });
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir), { env: SHORT_TIMEOUT });
        // EXECUTION: the request reached the worker (the body was read) and no answer came back.
        expect(worker.saveBodies).toHaveLength(1);
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('did not answer');
        expect(result.stderr).toContain('may or may not have applied this save');
        expect(result.stderr).toContain('Run the same command again');
        expect(result.stderr).not.toContain('Nothing was written');
        expect(result.stderr).not.toContain('Traceback');
        expect(result.stderr).not.toContain('not reachable');
      } finally { await worker.stop(); }
    }));

    it('when the worker applied the save and the answer was lost, running it again changes nothing: the rows, the area and the rules are not written twice', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'), { saveBehavior: 'apply-then-hang' });
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const lost = await worker.run(saveArgs(dir), { env: SHORT_TIMEOUT });
        expect(lost.exitCode).toBe(3);
        // EXECUTION: the first request committed in the worker, so the lost answer is a lost answer and not a refusal.
        expect(worker.atomicSaves).toEqual({ entered: 1, rowsInserted: 4, committed: 1 });
        const rowsAfterFirst = worker.rows();
        const storyAfterFirst = readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8');
        expect(JSON.parse(storyAfterFirst).preferences.map((preference: { source: string }) => preference.source)).toEqual(['owner-goals']);

        worker.setSaveBehavior(null);
        const again = await worker.run(saveArgs(dir));
        expect(again.stderr).toBe('');
        expect(again.exitCode).toBe(0);
        expect(JSON.parse(again.stdout)).toMatchObject({ already_applied: true, saved_focus_areas: 1, saved_asks: 1, saved_rules: 1, list: 'owner-goals' });
        // EXECUTION: the rerun reached the worker's save route, which recognized it; its store was not entered again.
        expect(worker.saveBodies).toHaveLength(2);
        expect(worker.atomicSaves.entered).toBe(1);
        expect(worker.rows()).toEqual(rowsAfterFirst);
        expect(worker.focusAreas()).toHaveLength(1);
        expect(readFileSync(join(worker.ledgerDir, 'story.json'), 'utf8')).toBe(storyAfterFirst);
      } finally { await worker.stop(); }
    }));

    it('rerunning an earlier answer after a newer one is saved changes nothing: no second area, the list stays at the newer save (exit 0, already applied)', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        const newer = { ...answer, generated_at: '2026-10-22T09:30:00-07:00', human_summary: 'Newer.' };
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
        const [saved] = worker.focusAreas();
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...newer, focus_areas: [{ ...answer.focus_areas[0], matches: saved.focusAreaId }] }));
        expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
        const rowsAfterB = worker.rows();
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const again = await worker.run(saveArgs(dir));
        expect(again.exitCode).toBe(0);
        expect(JSON.parse(again.stdout)).toMatchObject({ already_applied: true });
        // EXECUTION: the rerun reached the worker's save route (third body) and was answered by a remembered key; the store ran twice.
        expect(worker.saveBodies).toHaveLength(3);
        expect(worker.atomicSaves.entered).toBe(2);
        expect(worker.rows()).toEqual(rowsAfterB);
        expect(worker.focusAreas()).toHaveLength(1);
      } finally { await worker.stop(); }
    }));

    it('a relative and an absolute --map are one save: the second is already applied', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        writeFileSync(join(dir, 'owner-map.md'), '# map\n');
        const absolute = await worker.run(saveArgs(dir, '--map', join(dir, 'owner-map.md')));
        expect(absolute.exitCode).toBe(0);
        const relative = await worker.run(['--goals', 'goals.json', '--prompts', 'owner-prompts.md', '--map', 'owner-map.md'], { cwd: dir });
        expect(relative.exitCode).toBe(0);
        expect(JSON.parse(relative.stdout).already_applied).toBe(true);
        // EXECUTION: both requests reached the worker, and the second was recognized there.
        expect(worker.saveBodies).toHaveLength(2);
        expect(worker.atomicSaves.entered).toBe(1);
        expect(worker.focusAreas()).toHaveLength(1);
      } finally { await worker.stop(); }
    }));

    it('a save with an earlier generated_at that was never applied is a new save and is applied (exit 0); a dry run of an applied save lists no writes', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, generated_at: '2099-01-01T00:00:00Z' }));
        expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
        const [saved] = worker.focusAreas();
        const earlier = { ...answer, generated_at: '2026-10-20T09:30:00-07:00', human_summary: 'Earlier stamp, never applied.', focus_areas: [{ ...answer.focus_areas[0], matches: saved.focusAreaId }] };
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(earlier));
        const result = await worker.run(saveArgs(dir));
        // EXECUTION: the second save reached the worker's route and the store, and was applied, not recognized.
        expect(worker.saveBodies).toHaveLength(2);
        expect(worker.atomicSaves.entered).toBe(2);
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).already_applied).toBe(false);
        const dry = await worker.run([...saveArgs(dir), '--dry-run']);
        expect(dry.exitCode).toBe(0);
        expect(JSON.parse(dry.stdout).worker).toMatchObject({ alreadyApplied: true, writes: [] });
        expect(worker.saveBodies).toHaveLength(3);
        expect(worker.atomicSaves.entered).toBe(2);
      } finally { await worker.stop(); }
    }));

    it('a failed commit whose story.json cannot be put back is ambiguous (exit 3): the rows are gone, the message names the file and says a rerun replaces the same rules', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'), { failBeforeCommit: true, breakStoryOnFailure: true });
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const result = await worker.run(saveArgs(dir));
        // EXECUTION: the store inserted every row and ran the story write before the fault; the worker then answered 500 (it did answer).
        expect(worker.atomicSaves.rowsInserted).toBeGreaterThan(0);
        expect(worker.atomicSaves.committed).toBe(0);
        expect(worker.rows()).toEqual([]);
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain(join(worker.ledgerDir, 'story.json'));
        expect(result.stderr).toContain('holds the new rules');
        expect(result.stderr).toContain('replaces the same');
        expect(result.stderr).not.toContain('Nothing was written');
        expect(result.stderr).not.toContain('Traceback');
      } finally { await worker.stop(); }
    }));

    it('a different answer is not mistaken for the one already applied', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        expect((await worker.run(saveArgs(dir))).exitCode).toBe(0);
        writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, generated_at: '2026-10-22T09:30:00-07:00' }));
        const next = await worker.run(saveArgs(dir));
        expect(next.exitCode).toBe(0);
        expect(JSON.parse(next.stdout).already_applied).toBe(false);
        expect(worker.atomicSaves.committed).toBe(2);
      } finally { await worker.stop(); }
    }));

    it('a connection dropped before any answer to the save may have been applied: exit 3, with no traceback', () => withDir(async (dir) => {
      let requests = 0;
      const dropper: NetServer = createServer((socket) => { requests++; socket.once('data', () => socket.destroy()); });
      await new Promise<void>((done) => dropper.listen(0, '127.0.0.1', done));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        const port = (dropper.address() as { port: number }).port;
        const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
        try {
          const result = await worker.run(saveArgs(dir), { workerPort: port });
          expect(requests).toBeGreaterThan(0);
          expect(result.exitCode).toBe(3);
          expect(result.stderr).toContain('did not answer');
          expect(result.stderr).toContain('may or may not have applied this save');
          expect(result.stderr).not.toContain('Traceback');
          expect(worker.rows()).toEqual([]);
        } finally { await worker.stop(); }
      } finally { await new Promise<void>((done) => dropper.close(() => done())); }
    }));

    for (const [value, why] of [['0', 'zero'], ['-5', 'negative'], ['abc', 'not a number'], ['nan', 'NaN'], ['inf', 'infinite'], ['1e999', 'overflowing'], ['3601', 'above the bound'], ['1e10', 'absurdly large']] as const) {
      it(`CLAUDE_MEM_WORKER_TIMEOUT_SECONDS=${value} (${why}) is refused by name before anything is sent, with no traceback`, () => withDir(async (dir) => {
        const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
        try {
          writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
          for (const args of [saveArgs(dir), ['--print-focus-areas']]) {
            const result = await worker.run(args, { env: { CLAUDE_MEM_WORKER_TIMEOUT_SECONDS: value } });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('CLAUDE_MEM_WORKER_TIMEOUT_SECONDS must be a positive number of seconds, at most 3600');
            expect(result.stderr).toContain(value);
            expect(result.stderr).not.toContain('Traceback');
          }
          // EXECUTION: the check ran before any request: the worker was never asked.
          expect(worker.requests).toEqual([]);
        } finally { await worker.stop(); }
      }));
    }

    it('a positive timeout up to the bound (2.5, 3600) and an empty one are accepted', () => withDir(async (dir) => {
      const worker = await fakeOwnerGoalsWorker(join(dir, 'data'));
      try {
        writeFileSync(join(dir, 'goals.json'), JSON.stringify(answer));
        for (const [index, value] of ['2.5', '', '3600'].entries()) {
          writeFileSync(join(dir, 'goals.json'), JSON.stringify({ ...answer, generated_at: `2026-10-2${index}T09:30:00-07:00` }));
          expect((await worker.run(saveArgs(dir), { env: { CLAUDE_MEM_WORKER_TIMEOUT_SECONDS: value } })).exitCode).toBe(0);
        }
      } finally { await worker.stop(); }
    }));
  });
});

describe('export_owner_prompts.py', () => {
  it('leaves text the owner marked private out of the exported prompts', () => {
    const home = mkdtempSync(join(tmpdir(), 'export-owner-home-'));
    try {
      const projectDir = join(home, '.claude', 'projects', '-repo');
      mkdirSync(projectDir, { recursive: true });
      const typed = (uuid: string, text: string) => JSON.stringify({ type: 'user', uuid, sessionId: 'session-1', timestamp: new Date().toISOString(), entrypoint: 'cli', origin: { kind: 'human' }, message: { content: text } });
      writeFileSync(join(projectDir, 'session-1.jsonl'), [
        typed('u1', 'ship the cards <private>key sk-123</private> today · İstanbul 🚀'),
        typed('u2', '<private>only a secret</private>'),
        typed('u3', 'explain how <private> works'),
      ].join('\n') + '\n');
      const out = join(home, 'out');
      const result = spawnPython([join(SKILLS, 'owner-goals', 'scripts', 'export_owner_prompts.py'), '--out', out, '--days', '1'], { env: { ...process.env, HOME: home, USERPROFILE: home } });
      expect(result.exitCode).toBe(0);
      const exported = readFileSync(join(out, 'owner-prompts.md'), 'utf8');
      expect(exported).not.toContain('sk-123');
      expect(exported).not.toContain('only a secret');
      expect(exported).toContain('ship the cards  today · İstanbul 🚀');
      expect(exported).toContain('explain how <private> works');
      expect(JSON.parse(result.stdout.toString().trim().split('\n').pop()!).owner_prompts).toBe(2);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('reads transcripts from CLAUDE_CONFIG_DIR and dates them in local time across daylight saving', () => {
    const home = mkdtempSync(join(tmpdir(), 'export-owner-home-'));
    try {
      const projectDir = join(home, 'custom-claude', 'projects', '-repo');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'session-1.jsonl'), JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 'session-1', timestamp: '2026-07-15T12:00:00.000Z', entrypoint: 'cli', origin: { kind: 'human' }, message: { content: 'summer prompt' } }) + '\n');
      const out = join(home, 'out');
      const result = spawnPython([join(SKILLS, 'owner-goals', 'scripts', 'export_owner_prompts.py'), '--out', out, '--start', '2026-07-14', '--end', '2026-07-16'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, 'custom-claude'), TZ: 'America/New_York' },
      });
      expect(result.stderr.toString()).toBe('');
      // 12:00 UTC is 08:00 in New York during daylight saving time (EDT, UTC-4).
      expect(readFileSync(join(out, 'owner-prompts.md'), 'utf8')).toContain('## 2026-07-15 08:00 · claude · -repo');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
