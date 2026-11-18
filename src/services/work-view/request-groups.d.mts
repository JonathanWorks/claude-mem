export const LEDGER_DIR: string;
export const GOALS_STALE_MS: number;
export const AGENT_WRITTEN_PROMPTS_FILE: string;
export interface RefreshNeeds { due: number; ungrouped: number; goalsStale: boolean; unplaced: number; otherChanged: boolean; needed: boolean }
export interface LedgerDatabase { prepare(sql: string): { all(...params: unknown[]): any[]; get(...params: unknown[]): any } }
export interface SavedGoal {
  /** The item's work-state task. */
  taskKey: string; kind: 'focus-area' | 'ask';
  /** Saved under an old kind (priority, open ask) before the three tests; the next refresh sorts it again. */
  legacy: boolean;
  rank: number | null; title: string;
  /** A focus area's one-sentence goal (the only meaning of goal). */
  goal: string | null;
  /** An ask's focus area by the name it was saved with. focusAreaId is that area's my-focus id, or a focus area's own. */
  focusArea: string | null; focusAreaId: string | null;
  latestAt: string | null; timesAsked: number | null; evidence: Array<{ at: string; quote: string }>;
}
export interface SavedGoals { summary: string | null; generatedAt: string | null; mapPath: string | null; goals: SavedGoal[] }
export function readGoals(database: LedgerDatabase): SavedGoals;
export function readConversationProjects(database: LedgerDatabase, conversationKeys: string[]): Map<string, string>;
export function groupIdFor(anchorConversationKey: string): string;
export function refreshNeeds(options: { dir?: string; database: LedgerDatabase; now?: number; days?: number; localDeviceId: string }): RefreshNeeds;
export function writeJsonAtomic(path: string, value: unknown): void;
/** Thrown by writeJsonAtomic on a worker thread: the worker's main thread is the ledger's only writer. */
export const LEDGER_OFF_MAIN_THREAD_CODE: 'LEDGER_OFF_MAIN_THREAD';
/** Thrown by factLookups for a conversation whose facts were not supplied; `needed` lists them by table. */
export const LEDGER_FACTS_NEEDED_CODE: 'LEDGER_FACTS_NEEDED';
/** What a merge reads from the database. `projectsOf` answers by conversation key; `anchorAsksOf` by anchor key (a missing key is absent). */
export interface MergeLookups {
  projectsOf(keys: string[]): Map<string, string>;
  anchorAsksOf(keys: string[]): Map<string, any>;
}
/** The lookups' answers as plain data, null for "looked up, not found". */
export interface MergeFacts { projects: Record<string, string | null>; anchorAsks: Record<string, any | null> }
export function databaseLookups(database: LedgerDatabase, excludedPromptIds?: Set<number> | null): MergeLookups;
export function factLookups(facts: Partial<MergeFacts> | null | undefined): MergeLookups;
export function recordingLookups(lookups: MergeLookups): MergeLookups & { facts(): MergeFacts };
export function readLedger(dir?: string): Record<string, any>;
export function readGroupsFile(dir?: string): Record<string, any>;
export function readStoryFile(dir?: string): Record<string, any> | null;
export function readAgentWrittenPromptIds(dir?: string): Set<number>;
export function readCandidates(database: LedgerDatabase, options: { sinceEpoch?: number; conversationKeys?: string[] | null; fullAsks?: boolean; excludedPromptIds?: Set<number> | null }): any[];
export function ledgerSignature(dir?: string): string;
/** The decisions `apply` takes, merged into `stored` with projects and first asks read from the database; not written. */
export function applyDecisions(stored: Record<string, any> | null, decisions: unknown, options: { database: LedgerDatabase; now?: number; excludedPromptIds?: Set<number> | null }): Record<string, any>;
/** The decisions `apply` takes, merged into `stored` with projects and first asks from `lookups`; not written. */
export function applyDecisionsWith(stored: Record<string, any> | null, decisions: unknown, now: number, lookups: MergeLookups): Record<string, any>;
/** What the writes print: `apply`, `record-progress` and `record-story`. */
export interface ApplyWritten { groups: number; conversations: number }
export interface ProgressWritten { recorded: string; state: string; percent: number; readings: number }
export interface StoryWritten { recorded: 'story'; preferences: number }
/** The ledger's writes: one synchronous read-modify-write of the file as it is now. Only the worker's main thread (or a process of its own) calls these. */
export function writeDecisions(dir: string, decisions: unknown, options: { now: number; lookups: MergeLookups }): ApplyWritten;
export function writeProgress(dir: string, answer: unknown, options: { now: number }): ProgressWritten;
export function writeStory(dir: string, validated: { preferences: unknown[] } & Record<string, unknown>, options: { now: number }): StoryWritten;
/** Who writes the ledger for runCli and routeUndecided: the files here (localLedgerWriter), or the worker's main thread (ledger-writes.mjs). */
export interface LedgerWriter {
  apply(decisions: unknown, context: { database: LedgerDatabase; now: number }): ApplyWritten | Promise<ApplyWritten>;
  recordProgress(answer: unknown, context: { now: number }): ProgressWritten | Promise<ProgressWritten>;
  recordStory(validated: unknown, context: { now: number }): StoryWritten | Promise<StoryWritten>;
  place?(placement: LedgerPlacement, context: { database: LedgerDatabase; now: number }): PlacementOutcome | Promise<PlacementOutcome>;
}
export function localLedgerWriter(dir: string): Omit<LedgerWriter, 'place'>;
/** One conversation's placement as the judge decided it. `picked` is the request it chose, as offered. */
export interface LedgerPlacement {
  key: string; root: string | null; title: string;
  verdict: { requestId: string | null; band: 'join' | 'suggest' | 'new'; confidence: number; evidence: string; judge: string; rejected?: string };
  picked: { groupId: string; anchor: string; title: string } | null;
}
export type PlacementOutcome = { skip: true } | { unplaced: string } | { target: { groupId: string; anchor: string; title: string } | null; suggested: { groupId: string; anchor: string; title: string } | null; title: string };
/** A judge's mid-band pick waiting for the owner's Join / Not this (request-judge.mjs). */
export interface RequestSuggestion { conversationKey: string; requestId: string; requestTitle: string; confidence: number; evidence: string; judge: string; at: string | null }
export function openSuggestions(ledger: Record<string, any> | null | undefined): RequestSuggestion[];
export function groupingInput(ledger: Record<string, any>, database: LedgerDatabase, options: { sinceEpoch: number; limit?: number; skip?: Set<string> | null }): GroupingInput;
export function runCli(argv: string[], options?: {
  dir?: string; database?: LedgerDatabase | null; now?: number; print?: (value: any) => void;
  /** The worker's sync device id ('' when cloud sync never started); required by focus-input, record-focus and refresh-needs. */
  localDeviceId?: string;
  /** record-focus: writes the checked answer through the worker; throws a TypeError when refused before writing. */
  saveFocus?: ((body: import('./my-focus.mjs').RouterFocusBody) => { placed: number; focusAreaIds: string[] } | Promise<{ placed: number; focusAreaIds: string[] }>) | null;
  /** `judge`: the Jev judge for the `judge` command (undefined: from the install's settings; null: code links only). That command answers with a promise. */
  judge?: import('./request-judge.mjs').RequestJudge | null;
  /** Who writes `apply`, `record-progress`, `record-story` and `judge --apply` (undefined: this process, in the files). A writer that answers with a promise makes the command answer with one. */
  ledger?: LedgerWriter | null;
}): void | Promise<void>;
export interface FocusRequestRecord {
  anchor: string; groupId: string; title: string; firstAsk: string | null; state: string | null; summary: string | null; repo: string | null;
  /** How many conversations the request holds, and each one's opening ask. */
  conversations: number; conversationAsks: string[];
}
type FocusAreaRecord = { focusAreaId: string; name: string; goal: string | null; about: string | null; status: string };
export interface FocusInput { areas: FocusAreaRecord[]; dismissed: FocusAreaRecord[]; requests: FocusRequestRecord[]; remaining: number }
export interface OtherInput { areas: FocusAreaRecord[]; dismissed: FocusAreaRecord[]; other: FocusRequestRecord[]; due: boolean }
export const GROUPING_BATCH: number;
export const FOCUS_BATCH: number;
export function focusBasis(ledger: Record<string, any>, groupId: string): string;
export function focusInput(ledger: Record<string, any>, focus: ReturnType<typeof import('./my-focus.mjs').buildFocusAreas>, localDeviceId: string, database: LedgerDatabase, options?: { limit?: number }): FocusInput;
export function otherInput(ledger: Record<string, any>, focus: ReturnType<typeof import('./my-focus.mjs').buildFocusAreas>, localDeviceId: string, database: LedgerDatabase): OtherInput;
export function validateFocusAnswer(answer: unknown, input: FocusInput | OtherInput, ledger: Record<string, any>, options?: { other?: boolean }): import('./my-focus.mjs').RouterFocusBody;
export interface GroupingInput {
  root: string | null;
  conversations: Array<{ conversationKey: string; project: string; startedAt: string | null; openingAsk: string | null; workLists: string[] }>;
  openRequests: Array<{ groupId: string; title: string; anchor: string; anchorAsk: string | null; recentAsks: string[]; lastActivityAt: string | null }>;
  proposedLinks: Array<{ kind: string; conversations: string[]; evidence: string; groups: string[] }>;
  remaining: number;
}
export function validateGroupingAnswer<T>(answer: T, input: GroupingInput): T;
