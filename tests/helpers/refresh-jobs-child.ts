// A child process for tests/work-view/refresh-job.test.ts: runs three refresh jobs back to back through the real client (the process's
// shared job thread) closes the client as the worker's shutdown does, and then ends by itself. On bun 1.3.8 a job thread that loaded bun:sqlite and was terminated kills the process (exit 133),
// so the parent test reads this process's exit code. It prints one JSON line: each job's state, how many threads the job client started, and what each later thread answered.
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextReadWorkerClient, closeContextReadWorker, getRefreshJobWorker } from '../../src/services/context/ContextReadWorkerClient.js';
import { runAgentTask, type AgentRunnerDependencies } from '../../src/services/agent-runner/run.js';
import { applyLedgerWrite } from '../../src/services/work-view/ledger-writes.mjs';
import { remoteRefreshTask } from '../../src/services/work-view/refresh-job-client.js';
import { everyRequestInOther, focusWriter } from './fake-focus-writer.js';

const DAY = 86400000;
const PLUGIN_ROOT = join(import.meta.dir, '..', '..', 'plugin');
const NEEDS = { due: 0, ungrouped: 1, goalsStale: false, unplaced: 0, otherChanged: false, needed: true };
const KEY = JSON.stringify(['conversation', 'claude', 'a']);
const JOBS = 3;
const LATER_THREADS = 6;

function answerFor(prompt: string): string {
  if (prompt.includes('Do only section 1')) return JSON.stringify({ groups: [{ title: 'Release cards', conversations: [KEY] }], ignored: [] });
  if (prompt.includes('Do only section 2')) {
    const [show] = JSON.parse(readFileSync(/is in (\S+\.json)/.exec(prompt)![1], 'utf8'));
    return JSON.stringify({ reviews: [{ groupId: show.groupId, state: 'in-progress', percent: 40, summary: 'Cards are being built.', reviewBasis: show.reviewBasis }] });
  }
  if (prompt.includes('Do only section 3')) return everyRequestInOther(prompt);
  if (prompt.includes('Do only section 4')) return JSON.stringify({ narrative: 'One request is under way.', preferences: [] });
  throw new Error(`Unexpected prompt: ${prompt.slice(-200)}`);
}

const agent: Partial<AgentRunnerDependencies> = {
  detect: async () => [{ id: 'claude-code', path: '/not/run/claude', authenticated: true, reason: 'fixture' }],
  buildEnv: async () => ({}),
  query: (({ prompt }: { prompt: string }) => (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: answerFor(prompt) };
  })()) as unknown as AgentRunnerDependencies['query'],
};

const directory = mkdtempSync(join(tmpdir(), 'refresh-jobs-child-'));
const databasePath = join(directory, 'source.db');
const ledgerDir = join(directory, 'ledger');
mkdirSync(ledgerDir, { recursive: true });
const now = Date.now();
const fixture = new Database(databasePath);
fixture.exec(`CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, platform_source TEXT, content_session_id TEXT, memory_session_id TEXT, project TEXT, user_prompt TEXT, started_at_epoch INTEGER);
  CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER);
  CREATE TABLE tool_uses (id INTEGER PRIMARY KEY, session_db_id INTEGER, tool_name TEXT, tool_input TEXT, created_at_epoch INTEGER);
  CREATE TABLE observations (id INTEGER PRIMARY KEY, memory_session_id TEXT, type TEXT, title TEXT, subtitle TEXT, created_at_epoch INTEGER);
  CREATE TABLE work_state_entries (id INTEGER PRIMARY KEY, project TEXT, list_name TEXT, fields TEXT, created_at_epoch INTEGER);`);
fixture.prepare('INSERT INTO sdk_sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 'claude', 'a', 'm1', 'repo/tree', 'Build the release cards', now - 3 * DAY);
fixture.prepare('INSERT INTO user_prompts (session_db_id, prompt_number, prompt_text, created_at_epoch) VALUES (?, ?, ?, ?)').run(1, 1, 'Build the release cards', now - 3 * DAY);
const focus = focusWriter(fixture, { firstEpoch: now });

const states: string[] = [];
for (let job = 0; job < JOBS; job++) {
  const task = remoteRefreshTask({
    needs: NEEDS, reason: `job ${job}`, localDeviceId: '', saveFocus: body => focus.save(body),
    settings: { databasePath, dataDir: directory, ledgerDir, pluginRoot: PLUGIN_ROOT, settingsPath: join(directory, 'settings.json') },
    writeLedger: async op => applyLedgerWrite(ledgerDir, op),
  });
  try { states.push((await runAgentTask(task, agent)).state); } finally { await task.close(); }
}
fixture.close();
const threadsStarted = getRefreshJobWorker().threadsStarted;
// The worker's shutdown path: it closes the job thread's client while the thread is alive, and that must not end the thread either.
await closeContextReadWorker();
// Threads that load bun:sqlite after the first one was closed, each closed in turn: on bun 1.3.8 this is where a thread that was ended
// before it dies (exit 133). Several, because the crash does not come on every one.
const laterAnswers: string[] = [];
for (let index = 0; index < LATER_THREADS; index++) {
  const later = new ContextReadWorkerClient();
  laterAnswers.push(await later.refreshJobPrepare('never-started').then(() => 'resolved', (error: Error) => error.message));
  await later.close();
}
console.log(JSON.stringify({ states, threadsStarted, laterAnswers }));
