import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import {
  rebuildError, serializeError,
  type ContextReadCallbackHandlers, type ContextReadCallbackRequest, type ContextReadCallbackResult, type ContextReadMethods,
  type ContextReadReply, type ContextReadRequest, type ContextReadResult, type ContextRenderRequest,
} from './ContextReadProtocol.js';
import type { WorkStateEntry } from '../sqlite/work-state.js';
import type { ObservationSearchResult, SearchOptions, SessionSummarySearchResult, UserPromptSearchResult } from '../sqlite/types.js';
import type { RefreshNeeds } from '../work-view/request-groups.mjs';
import type { LastPromptsInput, RefreshNeedsInput, WorkViewReadInput, WorkViewRulesResult } from '../work-view/work-view-sources.js';
import type { RefreshJobRunInput, RefreshJobRunResult, RefreshJobStartInput } from '../work-view/refresh-job-host.js';
import { CONTEXT_PLACEHOLDER_NONCE } from '../../shared/context-cache.js';

const MAX_PENDING_READS = 64;

type PendingRead = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  /** Answers the worker's callbacks while this request runs (the refresh job's agent questions, my-focus write and ledger changes). */
  handlers?: ContextReadCallbackHandlers;
};

export class ContextReadWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingRead>();
  private nextId = 0;
  private closed = false;
  private started = 0;

  /** How many threads this client has started: a client that keeps one thread for its life reads 1. */
  get threadsStarted(): number { return this.started; }

  async render(request: ContextRenderRequest): Promise<ContextReadResult> {
    return this.request('render', request);
  }

  async readKeys(projects: string[]): Promise<string[]> {
    return this.request('readKeys', { projects });
  }

  async workState(projects: string[], localDeviceId = ''): Promise<WorkStateEntry[]> {
    return this.request('workState', { projects, localDeviceId });
  }

  async hasObservations(projects: string[], platformSource?: string): Promise<boolean> {
    return this.request('hasObservations', { projects, platformSource });
  }

  async projectsForCwd(cwd: string): Promise<string[]> {
    return this.request('projectsForCwd', { cwd });
  }

  async searchObservations(query: string | undefined, options: SearchOptions): Promise<ObservationSearchResult[]> {
    return this.request('searchObservations', { query, options });
  }

  async searchSessions(query: string | undefined, options: SearchOptions): Promise<SessionSummarySearchResult[]> {
    return this.request('searchSessions', { query, options });
  }

  async searchUserPrompts(query: string | undefined, options: SearchOptions): Promise<UserPromptSearchResult[]> {
    return this.request('searchUserPrompts', { query, options });
  }

  async workViewRead(input: WorkViewReadInput): Promise<string> {
    return this.request('workViewRead', input);
  }

  async workViewRules(input: WorkViewReadInput): Promise<WorkViewRulesResult> {
    return this.request('workViewRules', input);
  }

  async workViewRefreshNeeds(input: RefreshNeedsInput): Promise<RefreshNeeds> {
    return this.request('workViewRefreshNeeds', input);
  }

  async workViewLastPrompts(input: LastPromptsInput): Promise<number[]> {
    return this.request('workViewLastPrompts', input);
  }

  async refreshJobStart(input: RefreshJobStartInput): Promise<null> {
    return this.request('refreshJobStart', input);
  }

  async refreshJobPrepare(jobId: string): Promise<null> {
    return this.request('refreshJobPrepare', { jobId });
  }

  async refreshJobEnd(jobId: string): Promise<null> {
    return this.request('refreshJobEnd', { jobId });
  }

  /** `handlers` answer the job's callbacks (an agent question, the my-focus write, a ledger change) on this thread while it runs. */
  async refreshJobRun(input: RefreshJobRunInput, handlers: ContextReadCallbackHandlers): Promise<RefreshJobRunResult> {
    return this.request('refreshJobRun', input, handlers);
  }

  /**
   * Releases the thread without ending it: the client forgets it, rejects what it was waiting for and lets the process end it. A thread
   * that loaded bun:sqlite must never be terminated: on bun 1.3.8 worker.terminate() (and process.exit inside the thread) kills the whole
   * process (exit 133), even after the database was closed. An unref'd idle thread keeps nothing alive.
   */
  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.rejectPending(new Error('Context reader closed'));
    worker?.unref();
  }

  private getWorker(): Worker {
    if (this.closed) throw new Error('Context reader closed');
    if (this.worker) return this.worker;
    const candidates = ['context-read-worker.ts', 'context-read-worker.cjs']
      .map(name => new URL(name, import.meta.url));
    // Standalone builds embed this entrypoint under its emitted JavaScript name.
    const entry = candidates.find(candidate => existsSync(candidate))
      ?? new URL('./context-read-worker.js', import.meta.url);
    const worker = new Worker(entry, { workerData: { contextPlaceholderNonce: CONTEXT_PLACEHOLDER_NONCE } });
    this.worker = worker;
    this.started++;
    worker.on('message', (message: ContextReadReply | ContextReadCallbackRequest) => {
      if ('callback' in message) { void this.answerCallback(worker, message); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(rebuildError(message.error));
      if (this.pending.size === 0) worker.unref();
    });
    worker.on('error', error => {
      this.failWorker(worker, error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', code => this.failWorker(worker, new Error(`Context reader exited with code ${code}`)));
    return worker;
  }

  /** Runs the callback a request's worker asked for, and posts the answer (or the error, as it was thrown) back to the thread. */
  private async answerCallback(worker: Worker, message: ContextReadCallbackRequest): Promise<void> {
    const handler = this.pending.get(message.id)?.handlers?.[message.callback] as ((input: unknown) => Promise<unknown>) | undefined;
    let answer: ContextReadCallbackResult;
    try {
      if (!handler) throw new Error(`The ${message.callback} callback has no handler on request ${message.id}.`);
      answer = { callbackResult: true, callbackId: message.callbackId, ok: true, result: await handler(message.input) };
    } catch (error) {
      answer = { callbackResult: true, callbackId: message.callbackId, ok: false, error: serializeError(error) };
    }
    // The thread may have been closed or replaced while the callback ran; its pending reads were rejected then.
    if (this.worker === worker) worker.postMessage(answer);
  }

  private request<Method extends keyof ContextReadMethods>(
    method: Method,
    input: ContextReadMethods[Method]['input'],
    handlers?: ContextReadCallbackHandlers,
  ): Promise<ContextReadMethods[Method]['result']> {
    if (this.pending.size >= MAX_PENDING_READS) return Promise.reject(new Error('Context reader queue is full'));
    const worker = this.getWorker();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as ContextReadMethods[Method]['result']), reject, handlers });
      worker.ref();
      try {
        worker.postMessage({ id, method, input } as ContextReadRequest);
      } catch (error) {
        this.pending.delete(id);
        if (this.pending.size === 0) worker.unref();
        reject(error);
      }
    });
  }

  private failWorker(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

const readerState: { client?: ContextReadWorkerClient; jobClient?: ContextReadWorkerClient } = {};

export function getContextReadWorker(): ContextReadWorkerClient {
  readerState.client ??= new ContextReadWorkerClient();
  return readerState.client;
}

/**
 * The one thread every refresh job of this process runs on, started on first use and kept for the life of the process (never ended: see
 * ContextReadWorkerClient.close). It is not the reader's thread, so a long job never holds a read.
 */
export function getRefreshJobWorker(): ContextReadWorkerClient {
  readerState.jobClient ??= new ContextReadWorkerClient();
  return readerState.jobClient;
}

export async function closeContextReadWorker(): Promise<void> {
  await readerState.client?.close();
  await readerState.jobClient?.close();
}
