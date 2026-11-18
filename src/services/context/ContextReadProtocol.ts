import type { ContextConfig, ContextInput } from './types.js';
import type { ContextInjectStats } from './ContextBuilder.js';
import type { WorkStateEntry } from '../sqlite/work-state.js';
import type { ModeConfig } from '../domain/types.js';
import type { RefreshNeeds } from '../work-view/request-groups.mjs';
import type { LastPromptsInput, RefreshNeedsInput, WorkViewReadInput, WorkViewRulesResult } from '../work-view/work-view-sources.js';
import type { RefreshJobRunInput, RefreshJobRunResult, RefreshJobStartInput } from '../work-view/refresh-job-host.js';
import type { AnswerSchema, StepModels } from '../agent-runner/run.js';
import type { LedgerWriteOp, LedgerWriteReply } from '../work-view/ledger-writes.mjs';
import type { RouterFocusBody } from '../work-view/my-focus.mjs';
import type { ObservationSearchResult, SearchOptions, SessionSummarySearchResult, UserPromptSearchResult } from '../sqlite/types.js';

export interface ContextReadOptions {
  execution?: 'inline' | 'worker';
  reader?: ContextReadExecutor;
  config?: ContextConfig;
}

export interface ContextReadResult {
  text: string;
  stats: ContextInjectStats | null;
  readKeys?: string[];
}

export interface ContextRenderRequest {
  context?: ContextInput;
  forHuman: boolean;
  mode: ModeConfig;
  config: ContextConfig;
}

export interface ContextReadExecutor {
  render(request: ContextRenderRequest): Promise<ContextReadResult>;
}

export interface ContextReadMethods {
  render: {
    input: ContextRenderRequest;
    result: ContextReadResult;
  };
  readKeys: { input: { projects: string[] }; result: string[] };
  workState: { input: { projects: string[]; localDeviceId: string }; result: WorkStateEntry[] };
  hasObservations: { input: { projects: string[]; platformSource?: string }; result: boolean };
  projectsForCwd: { input: { cwd: string }; result: string[] };
  searchObservations: { input: { query: string | undefined; options: SearchOptions }; result: ObservationSearchResult[] };
  searchSessions: { input: { query: string | undefined; options: SearchOptions }; result: SessionSummarySearchResult[] };
  searchUserPrompts: { input: { query: string | undefined; options: SearchOptions }; result: UserPromptSearchResult[] };
  /** The built work-view agent view, as JSON text. */
  workViewRead: { input: WorkViewReadInput; result: string };
  workViewRules: { input: WorkViewReadInput; result: WorkViewRulesResult };
  workViewRefreshNeeds: { input: RefreshNeedsInput; result: RefreshNeeds };
  /** The newest prompt time of each conversation (epoch ms; 0 for none). */
  workViewLastPrompts: { input: LastPromptsInput; result: number[] };
  /** Opens the refresh job on this thread. A thread holds one job; the caller closes the thread when the job ends. */
  refreshJobStart: { input: RefreshJobStartInput; result: null };
  /** The job's prepare step (owner prompts). Runs only on a thread that got `refreshJobStart`. */
  refreshJobPrepare: { input: null; result: null };
  /** One agent's run of the job. It calls back to the requesting thread for each agent question and each my-focus write. */
  refreshJobRun: { input: RefreshJobRunInput; result: RefreshJobRunResult };
}

/**
 * What the refresh job asks of the thread that requested it. The job runs the database work; these are not
 * database work: the agent processes, the worker's my-focus write and every write of the request ledger belong to the requesting (main) thread.
 */
export interface ContextReadCallbacks {
  ask: { input: { prompt: string; models: StepModels; schema?: AnswerSchema }; result: string };
  saveFocus: { input: RouterFocusBody; result: { placed: number; focusAreaIds: string[] } };
  /** One change to the request ledger: the requesting (main) thread is its only writer, so the job's writes are messages. */
  writeLedger: { input: LedgerWriteOp; result: LedgerWriteReply };
}
export type ContextReadCallbackName = keyof ContextReadCallbacks;

/** The requesting side's answers, one per callback name, passed with a request that can call back. */
export type ContextReadCallbackHandlers = {
  [Name in ContextReadCallbackName]: (input: ContextReadCallbacks[Name]['input']) => Promise<ContextReadCallbacks[Name]['result']>;
};

/** Worker thread to requesting thread: run `callback` for the request `id`, and answer with `callbackId`. */
export interface ContextReadCallbackRequest { id: number; callbackId: number; callback: ContextReadCallbackName; input: unknown }
/** Requesting thread to worker thread: the answer to `callbackId`. */
export type ContextReadCallbackResult =
  | { callbackResult: true; callbackId: number; ok: true; result: unknown }
  | { callbackResult: true; callbackId: number; ok: false; error: SerializedError };

/** An error as it crosses a thread boundary: the callers branch on `TypeError` and `retryable`, so both survive. */
export interface SerializedError { name: string; message: string; retryable?: boolean }

export function serializeError(error: unknown): SerializedError {
  const failure = error instanceof Error ? error : new Error(String(error));
  const retryable = (failure as { retryable?: unknown }).retryable;
  return { name: failure.name, message: failure.message, ...(typeof retryable === 'boolean' ? { retryable } : {}) };
}

export function rebuildError(serialized: SerializedError): Error {
  const error = serialized.name === 'TypeError' ? new TypeError(serialized.message) : new Error(serialized.message);
  return Object.assign(error, { name: serialized.name }, serialized.retryable === undefined ? {} : { retryable: serialized.retryable });
}

export type ContextReadRequest = {
  [Method in keyof ContextReadMethods]: {
    id: number;
    method: Method;
    input: ContextReadMethods[Method]['input'];
  }
}[keyof ContextReadMethods];

export type ContextReadReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: SerializedError };
