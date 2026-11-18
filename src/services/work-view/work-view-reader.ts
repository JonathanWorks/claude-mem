import { ContextReadWorkerClient } from '../context/ContextReadWorkerClient.js';
import type { WorkViewSnapshot } from './data-source.mjs';
import type { RefreshNeeds } from './request-groups.mjs';
import { WorkViewSources, type LastPromptsInput, type RefreshNeedsInput, type WorkViewReadInput, type WorkViewRulesResult } from './work-view-sources.js';

/** Where the work view's database scans run. Both implementations answer the same reads; only the thread differs. */
export interface WorkViewReader {
  /** The built agent view for the database and ledger. */
  read(input: WorkViewReadInput): Promise<WorkViewSnapshot>;
  /** The saved rules only: no activity scan. */
  rules(input: WorkViewReadInput): Promise<WorkViewRulesResult>;
  /** What the automatic refresh would do now. */
  refreshNeeds(input: RefreshNeedsInput): Promise<RefreshNeeds>;
  /** The newest prompt time of each conversation, for the setup screen's work list. */
  lastPrompts(input: LastPromptsInput): Promise<number[]>;
  /** Stops the reader; reads still in flight reject. */
  close(): Promise<void>;
}

/** Runs the reads on the calling thread. Tests and tools use it; the worker process uses workerWorkViewReader. */
export function inlineWorkViewReader(): WorkViewReader {
  const sources = new WorkViewSources();
  return {
    read: async input => sources.read(input),
    rules: async input => sources.rules(input),
    refreshNeeds: async input => sources.refreshNeeds(input),
    lastPrompts: async input => sources.lastPrompts(input),
    close: async () => sources.close(),
  };
}

/**
 * Runs the reads on a thread of its own. It is a second ContextReadWorkerClient, never the shared one: a thread
 * answers one message at a time, so a SessionStart render queued behind a multi-second work-view read would wait for it.
 * The view crosses the thread boundary as JSON text, one string, rather than as a structured clone of its prompts.
 */
export function workerWorkViewReader(client: ContextReadWorkerClient = new ContextReadWorkerClient()): WorkViewReader {
  return {
    read: async input => JSON.parse(await client.workViewRead(input)) as WorkViewSnapshot,
    rules: input => client.workViewRules(input),
    refreshNeeds: input => client.workViewRefreshNeeds(input),
    lastPrompts: input => client.workViewLastPrompts(input),
    close: () => client.close(),
  };
}
