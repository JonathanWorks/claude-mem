/**
 * The main thread's side of the refresh job (refresh-job-host.ts runs the job). It is an AgentTask for runAgentTask, so
 * the agent processes stay here, but its `prepare` and `run` do nothing except message the job's thread: no database
 * handle is opened on this thread for the run. The thread is started on first use and ended by `close()`.
 */

import type { AgentTask } from '../agent-runner/run.js';
import { ContextReadWorkerClient } from '../context/ContextReadWorkerClient.js';
import { rebuildError } from '../context/ContextReadProtocol.js';
import type { LedgerWriteOp, LedgerWriteReply } from './ledger-writes.mjs';
import type { RouterFocusBody } from './my-focus.mjs';
import type { RefreshNeeds } from './request-groups.mjs';
import type { RefreshJobStartInput } from './refresh-job-host.js';
import { refreshTaskStatics, type StepTiming } from './refresh-task.js';

export interface RemoteRefreshTaskOptions {
  needs: RefreshNeeds;
  reason: string;
  /** The folders, database and settings the job's thread reads, as plain values. */
  settings: Pick<RefreshJobStartInput, 'databasePath' | 'dataDir' | 'ledgerDir' | 'pluginRoot' | 'settingsPath'>;
  localDeviceId: string;
  /** The focus step's write: the worker's system-only my-focus write, which stays on this (the main) thread. */
  saveFocus: (body: RouterFocusBody) => { placed: number; focusAreaIds: string[] } | Promise<{ placed: number; focusAreaIds: string[] }>;
  /** The job's ledger writes: the worker's main thread is the ledger's only writer, so each change the job intends reaches it here. */
  writeLedger: (op: LedgerWriteOp) => Promise<LedgerWriteReply>;
  /** A thread for this job alone; a new ContextReadWorkerClient unless a test supplies one. */
  createClient?: () => ContextReadWorkerClient;
}

export type RemoteRefreshTask = AgentTask & { steps: StepTiming[]; close(): Promise<void> };

export function remoteRefreshTask(options: RemoteRefreshTaskOptions): RemoteRefreshTask {
  const { needs, reason, settings } = options;
  const steps: StepTiming[] = [];
  // A thread per job: it holds the job's state (the saved goals, the owner prompts) from prepare to the last agent's run, and
  // ending it ends the job. It is started only once a logged-in agent exists, so an idle check starts nothing.
  let started: Promise<ContextReadWorkerClient> | null = null;
  const open = (): Promise<ContextReadWorkerClient> => started ??= (async () => {
    const client = (options.createClient ?? (() => new ContextReadWorkerClient()))();
    try { await client.refreshJobStart({ ...settings, needs, reason, localDeviceId: options.localDeviceId }); }
    catch (error) { await client.close(); throw error; }
    return client;
  })();
  return {
    reason,
    steps,
    ...refreshTaskStatics(settings.pluginRoot, settings.ledgerDir),
    prepare: needs.goalsStale ? async () => { await (await open()).refreshJobPrepare(); } : undefined,
    run: async (ask, agent) => {
      const client = await open();
      const outcome = await client.refreshJobRun({ agent }, {
        ask: ({ prompt, models, schema }) => ask(prompt, models, schema),
        saveFocus: async body => options.saveFocus(body),
        writeLedger: op => options.writeLedger(op),
      });
      // The thread's list holds every agent's steps so far, so it replaces ours rather than adding to it.
      steps.splice(0, steps.length, ...outcome.steps);
      if (outcome.error) throw rebuildError(outcome.error);
      return outcome.result ?? '';
    },
    close: async () => {
      const client = await started?.catch(() => null);
      await client?.close();
    },
  };
}
