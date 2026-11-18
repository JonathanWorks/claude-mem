import type { FocusArea, MinedFocusArea } from './my-focus.mjs';
import type { OwnerGoalsRule } from './request-groups.mjs';

/** The source a rule carries in the story. */
export const OWNER_GOALS_RULE_SOURCE: 'owner-goals';
/** A quote's local "YYYY-MM-DD HH:MM" as ISO 8601 with the offset; null when it is not a minute that exists. */
export function localIsoOf(at: string): string | null;
/** The key of a save's content: the same goals and period give the same key, however the map path is spelled (it is not part of the key). */
export function ownerGoalsSaveKey(input: { goals: unknown; period?: unknown }): string;
/** How many applied saves a list remembers. */
export const MAX_REMEMBERED_SAVE_KEYS: number;
/** The saves a list has applied, oldest first (at: epoch seconds when known). */
export function appliedSaveKeys(fields: Record<string, unknown> | null | undefined): Array<{ key: string; at: number | null }>;
/** Every problem that keeps the goals from being read as focus areas, asks and rules. */
export function goalsShapeProblems(goals: Record<string, unknown>): string[];
export function minedAreaOf(area: Record<string, any>): MinedFocusArea;
export function rulePreferenceOf(rule: Record<string, any>): OwnerGoalsRule;
export function listOf(period: { start: string; end: string } | null, today: string): { history: boolean; listName: string };

export interface OwnerGoalsSaveInput {
  goals: Record<string, any>;
  period?: { start: string; end: string } | null;
  mapPath?: string | null;
}
export interface OwnerGoalsSaveContext {
  savedAreas: FocusArea[];
  /** The tasks of this list that are still open: the ones this save drops when it no longer has them. */
  previousTasks: string[];
  /** The owner's local day, YYYY-MM-DD. */
  today: string;
  /** The saves this list has applied (appliedSaveKeys), kept on the new state row with this save's. */
  previousKeys?: Array<{ key: string; at: number | null }>;
  /** This save's time, epoch seconds; the current time when omitted. */
  appliedAt?: number;
  newId?: (index: number) => string;
}
export type OwnerGoalsSavePlan = { problems: string[] } | {
  listName: string; history: boolean; saveKey: string;
  minedAreas: MinedFocusArea[]; areaRows: Array<Record<string, string | number | null>>; focusAreaIds: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  preferences: OwnerGoalsRule[];
  droppedPrevious: number; newAreas: number;
  problems: string[];
};
export function planOwnerGoalsSave(input: OwnerGoalsSaveInput, context: OwnerGoalsSaveContext): OwnerGoalsSavePlan;
