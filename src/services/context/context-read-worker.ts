import type { Database } from 'bun:sqlite';
import { openSqliteDatabase } from '../sqlite/open-database.js';
import { parentPort } from 'node:worker_threads';
import { DB_PATH } from '../../shared/paths.js';
import { getProjectContext } from '../../utils/project-name.js';
import { ModeManager } from '../domain/ModeManager.js';
import { resolveRuntimeContext } from '../hooks/runtime-selector.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '../sqlite/connection.js';
import { projectReadKeys } from '../sqlite/project-read-keys.js';
import { getWorkStateEntries, scopeWorkStateEntries } from '../sqlite/work-state.js';
import { SessionSearch } from '../sqlite/SessionSearch.js';
import { countObservationsByProjects } from './ObservationCompiler.js';
import { generateContextWithStats } from './ContextBuilder.js';
import { runWithSqlScope } from '../sqlite/sql-scope.js';
import { WorkViewSources } from '../work-view/work-view-sources.js';
import { RefreshJobHost } from '../work-view/refresh-job-host.js';
import {
  rebuildError, serializeError,
  type ContextReadCallbackName, type ContextReadCallbackRequest, type ContextReadCallbackResult, type ContextReadCallbacks,
  type ContextReadReply, type ContextReadRequest,
} from './ContextReadProtocol.js';

if (!parentPort) throw new Error('Context reader requires a worker thread');
const port = parentPort;

function readDatabase<T>(read: (db: Database) => T): T {
  const db = openSqliteDatabase(DB_PATH, { readonly: true, create: false });
  try {
    db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.run('PRAGMA query_only = ON');
    return read(db);
  } finally {
    db.close();
  }
}

/**
 * Keyword search keeps one read-only connection for the life of this thread.
 * It is not `query_only`: SessionSearch builds fts5vocab tables in the
 * connection's temp schema to pick rare terms (#4804), and query_only refuses
 * even temp DDL, which silently degraded long and multi-word queries. The
 * read-only open still refuses every write to the database. Keeping the
 * connection also reuses those vocab tables and never closes a connection
 * under SessionSearch's prepared statements.
 */
let keywordSearch: SessionSearch | null = null;

function keywordSearchReader(): SessionSearch {
  if (keywordSearch) return keywordSearch;
  const db = openSqliteDatabase(DB_PATH, { readonly: true, create: false });
  try {
    db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    keywordSearch = new SessionSearch(db, { readOnly: true });
  } catch (error) {
    db.close();
    throw error;
  }
  return keywordSearch;
}

/** The work view's sources live as long as this thread, so their caches carry from one read to the next. */
const workViewSources = new WorkViewSources();

/** The refresh jobs this thread runs, by id. The thread serves every job of the process and is never ended, so each job is forgotten when it ends. */
const refreshJobs = new Map<string, RefreshJobHost>();

function openJob(jobId: string): RefreshJobHost {
  const job = refreshJobs.get(jobId);
  if (!job) throw new Error('The refresh job was not started on this thread.');
  return job;
}

const callbackWaits = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextCallbackId = 0;

/** Asks the thread that sent request `id` to run a callback (an agent question, the my-focus write, a ledger change) and waits for its answer. */
function callRequester<Name extends ContextReadCallbackName>(id: number, callback: Name, input: ContextReadCallbacks[Name]['input']): Promise<ContextReadCallbacks[Name]['result']> {
  const callbackId = ++nextCallbackId;
  return new Promise((resolve, reject) => {
    callbackWaits.set(callbackId, { resolve: value => resolve(value as ContextReadCallbacks[Name]['result']), reject });
    port.postMessage({ id, callbackId, callback, input } satisfies ContextReadCallbackRequest);
  });
}

function settleCallback(answer: ContextReadCallbackResult): void {
  const wait = callbackWaits.get(answer.callbackId);
  if (!wait) return;
  callbackWaits.delete(answer.callbackId);
  if (answer.ok) wait.resolve(answer.result);
  else wait.reject(rebuildError(answer.error));
}

async function execute(request: ContextReadRequest): Promise<unknown> {
  switch (request.method) {
    case 'render':
      if (resolveRuntimeContext().runtime !== 'worker') throw new Error('Context render reader only supports local SQLite');
      ModeManager.getInstance().useModeSnapshot(request.input.mode);
      return generateContextWithStats(request.input.context, request.input.forHuman, { config: request.input.config });
    case 'readKeys':
      return readDatabase(db => projectReadKeys(db, request.input.projects));
    case 'workState':
      return readDatabase(db => scopeWorkStateEntries(
        getWorkStateEntries(db, projectReadKeys(db, request.input.projects), undefined, request.input.localDeviceId),
        request.input.projects,
      ));
    case 'hasObservations':
      return readDatabase(db => countObservationsByProjects({ db }, request.input.projects, request.input.platformSource) > 0);
    case 'projectsForCwd':
      return getProjectContext(request.input.cwd).allProjects;
    case 'searchObservations':
      return keywordSearchReader().searchObservations(request.input.query, request.input.options);
    case 'searchSessions':
      return keywordSearchReader().searchSessions(request.input.query, request.input.options);
    case 'searchUserPrompts':
      return keywordSearchReader().searchUserPrompts(request.input.query, request.input.options);
    case 'workViewRead':
      return runWithSqlScope('worker:work-view.read', () => JSON.stringify(workViewSources.read(request.input)));
    case 'workViewRules':
      return runWithSqlScope('worker:work-view.rules', () => workViewSources.rules(request.input));
    case 'workViewRefreshNeeds':
      return runWithSqlScope('worker:work-view.refresh-needs', () => workViewSources.refreshNeeds(request.input));
    case 'workViewLastPrompts':
      return runWithSqlScope('worker:work-view.last-prompts', () => workViewSources.lastPrompts(request.input));
    case 'refreshJobStart':
      refreshJobs.set(request.input.jobId, new RefreshJobHost(request.input));
      return null;
    case 'refreshJobPrepare':
      await openJob(request.input.jobId).prepare();
      return null;
    case 'refreshJobEnd':
      refreshJobs.delete(request.input.jobId);
      return null;
    case 'refreshJobRun':
      return openJob(request.input.jobId).run(request.input.agent, {
        ask: (input) => callRequester(request.id, 'ask', input),
        saveFocus: (body) => callRequester(request.id, 'saveFocus', body),
        writeLedger: (op) => callRequester(request.id, 'writeLedger', op),
      });
  }
}

port.on('message', async (request: ContextReadRequest | ContextReadCallbackResult) => {
  if ('callbackResult' in request) { settleCallback(request); return; }
  try {
    const result = await execute(request);
    port.postMessage({ id: request.id, ok: true, result } satisfies ContextReadReply);
  } catch (error) {
    port.postMessage({ id: request.id, ok: false, error: serializeError(error) } satisfies ContextReadReply);
  }
});
