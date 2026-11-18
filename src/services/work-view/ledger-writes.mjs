// The request ledger has ONE writer inside the worker: its main thread. The refresh job runs on a thread of its own and never
// writes request-groups.json, story.json or a progress file; it sends each change it intends (a routing placement, the grouping
// agent's `apply`, a progress review, the story) to the main thread as a message, and the main thread applies it as one
// synchronous read-modify-write of the file as it is THEN (applyLedgerWrite, called inside WorkViewRoutes' serialized queue,
// the queue the owner's Join / Not this answers run in). No lock: with one writer, a change cannot be lost to another thread's
// write, and writeJsonAtomic refuses a write from any other thread (LEDGER_OFF_MAIN_THREAD), so a second writer fails loudly
// instead of racing. A skill script is a process of its own and writes its files itself (localLedgerWriter in request-groups.mjs).
//
// The main thread opens no database. A merge reads each touched conversation's project and each new group's first ask, so the
// job reads those first (facts) and sends them with the change. The change decides which conversations are touched against the
// ledger as the main thread finds it, which an owner's answer can have changed since the job read it; when the facts fall short
// the main thread answers `needFacts` instead of guessing, and the job reads what is missing and sends the change again.
import {
  applyDecisionsWith, databaseLookups, factLookups, LEDGER_FACTS_NEEDED_CODE, readAgentWrittenPromptIds, readGroupsFile, recordingLookups,
  writeDecisions, writeProgress, writeStory,
} from './request-groups.mjs';
import { placeConversation, writePlacement } from './request-judge.mjs';

/** Rounds of "send, learn what is missing, send again" before the job gives up: each round reads every key the main thread named. */
const MAX_FACT_ROUNDS = 8;

/**
 * The main thread's side: applies one change the job sent, to the ledger as it is now. Returns `{ done }` with what the change
 * answers, or `{ needFacts }` (nothing was written) naming the conversations whose facts the job must read and send again.
 * A refusal (a TypeError for an answer that does not validate) is thrown, as the CLI throws it.
 */
export function applyLedgerWrite(dir, op) {
  const lookups = factLookups(op?.facts);
  try {
    switch (op?.kind) {
      case 'apply': return { done: writeDecisions(dir, op.decisions, { now: op.now, lookups }) };
      case 'place': return { done: writePlacement(dir, op.placement, { now: op.now, lookups }) };
      case 'progress': return { done: writeProgress(dir, op.answer, { now: op.now }) };
      case 'story': return { done: writeStory(dir, op.validated, { now: op.now }) };
      default: throw new TypeError(`Unknown ledger write ${JSON.stringify(op?.kind)}.`);
    }
  } catch (error) {
    if (error?.code === LEDGER_FACTS_NEEDED_CODE) return { needFacts: error.needed };
    throw error;
  }
}

function readNeeded(lookups, needed, facts) {
  const next = { projects: { ...facts.projects }, anchorAsks: { ...facts.anchorAsks } };
  for (const [table, load] of [['projects', lookups.projectsOf], ['anchorAsks', lookups.anchorAsksOf]]) {
    const keys = needed?.[table] ?? [];
    if (!keys.length) continue;
    const found = load(keys);
    for (const key of keys) next[table][key] = found.get(key) ?? null;
  }
  return next;
}

/**
 * The job thread's side: a LedgerWriter (request-groups.mjs) whose every write is `send(op)` to the main thread, which answers
 * `{ done }` or `{ needFacts }` (applyLedgerWrite). A change that merges (`apply`, `place`) is first run here against this
 * thread's own read of the file, only to learn which conversations the main thread will look up and send their facts with it.
 * That run can differ from the main thread's, which merges against the file as it is then and is the one that counts.
 */
export function remoteLedgerWriter({ dir, send }) {
  const request = async (op, merge) => {
    let facts = { projects: {}, anchorAsks: {} };
    const lookups = merge ? databaseLookups(merge.database, readAgentWrittenPromptIds(dir)) : null;
    if (merge) {
      const recording = recordingLookups(lookups);
      // A failure here is not reported: the main thread repeats the merge on the file as it is, and reports its own.
      try { merge.dryRun(readGroupsFile(dir), recording); } catch { /* the prefetch only learns which facts to send */ }
      facts = recording.facts();
    }
    for (let round = 0; round < MAX_FACT_ROUNDS; round++) {
      const reply = await send({ ...op, facts });
      if ('done' in reply) return reply.done;
      if (!lookups) throw new Error(`The main thread asked for conversation facts for a ledger write (${op.kind}) that reads none.`);
      facts = readNeeded(lookups, reply.needFacts, facts);
    }
    throw new Error(`The ledger kept changing under a ${op.kind} write: the main thread still lacked conversation facts after ${MAX_FACT_ROUNDS} rounds. Nothing was written; run it again.`);
  };
  return {
    apply: (decisions, { database, now }) => request({ kind: 'apply', decisions, now }, { database, dryRun: (stored, lookups) => applyDecisionsWith(stored, decisions, now, lookups) }),
    place: (placement, { database, now }) => request({ kind: 'place', placement, now }, { database, dryRun: (stored, lookups) => placeConversation(stored, placement, { now, lookups }) }),
    recordProgress: (answer, { now }) => request({ kind: 'progress', answer, now }),
    recordStory: (validated, { now }) => request({ kind: 'story', validated, now }),
  };
}
