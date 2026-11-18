import type { ApplyWritten, LedgerPlacement, LedgerWriter, MergeFacts, OwnerGoalsRule, OwnerGoalsRulesWritten, PlacementOutcome, ProgressWritten, StoryWritten } from './request-groups.mjs';

/** One change to the ledger for the worker's main thread to make, from the refresh job or a skill script over HTTP; `facts` is what its merge reads from the database. */
export type LedgerWriteOp =
  | { kind: 'apply'; decisions: unknown; now: number; facts?: Partial<MergeFacts> }
  | { kind: 'place'; placement: LedgerPlacement; now: number; facts?: Partial<MergeFacts> }
  | { kind: 'progress'; answer: unknown; now: number }
  | { kind: 'story'; validated: unknown; now: number }
  | { kind: 'owner-goals-rules'; preferences: OwnerGoalsRule[] };

/** What a change came to: its answer, or the conversations whose facts the job must read and send again (nothing was written). */
export type LedgerWriteReply =
  | { done: ApplyWritten | PlacementOutcome | ProgressWritten | StoryWritten | OwnerGoalsRulesWritten }
  | { needFacts: { projects?: string[]; anchorAsks?: string[] } };

/** The main thread's side: one synchronous read-modify-write of the file as it is now. Throws a TypeError for an answer that does not validate. */
export function applyLedgerWrite(dir: string, op: LedgerWriteOp): LedgerWriteReply;
/** The job thread's side: a LedgerWriter that sends every write to the main thread through `send`. */
export function remoteLedgerWriter(options: { dir: string; send: (op: LedgerWriteOp) => Promise<LedgerWriteReply> }): Required<LedgerWriter>;
