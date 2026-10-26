import type { LightningNotice } from "./lightning-health";
import type { ProjectHealth } from "./data-health";
import type { Bar } from "./health-timeline";
import type { HazeHourlyEvidence } from "./scheduled-run-health";

/**
 * What "Refresh data health" is allowed to change on screen.
 *
 * The route answers with each part it could read and `null` for each it could not. The rule that
 * matters is the second half: **a part that was not read leaves what is on screen exactly as it
 * was.** Replacing it with an empty answer would blank every card's history, or clear a standing
 * fault, on the strength of a read that failed — "nothing is wrong" and "could not look" would
 * become the same picture, which is the one confusion this page exists to prevent.
 *
 * Each part is checked for its shape as well as for presence: an array where an array is expected,
 * an object where an object is, so a malformed answer changes nothing rather than something wrong.
 */
export type RefreshUpdates = {
  health?: ProjectHealth[];
  strips?: Record<string, Bar[]>;
  faults?: Record<string, string>;
  notices?: LightningNotice[];
  hazeHourlyEvidence?: HazeHourlyEvidence | null;
  /** When the answer was read, from the server; the browser's clock only if it did not say. */
  refreshedAt: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function refreshUpdates(body: unknown, fallbackNow: () => string = () => new Date().toISOString()): RefreshUpdates {
  const source = isPlainObject(body) ? body : {};
  const updates: RefreshUpdates = {
    refreshedAt: typeof source.fetchedAt === "string" && source.fetchedAt ? source.fetchedAt : fallbackNow(),
  };
  if (Array.isArray(source.health)) updates.health = source.health as ProjectHealth[];
  if (isPlainObject(source.strips)) updates.strips = source.strips as Record<string, Bar[]>;
  if (isPlainObject(source.faults)) updates.faults = source.faults as Record<string, string>;
  if (Array.isArray(source.notices)) updates.notices = source.notices as LightningNotice[];
  if (source.hazeHourlyEvidence === null) updates.hazeHourlyEvidence = null;
  else if (isPlainObject(source.hazeHourlyEvidence)
    && typeof source.hazeHourlyEvidence.checkedAt === "string"
    && Array.isArray(source.hazeHourlyEvidence.runs)) updates.hazeHourlyEvidence = source.hazeHourlyEvidence as HazeHourlyEvidence;
  return updates;
}
