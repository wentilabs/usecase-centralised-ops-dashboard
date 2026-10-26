import type { BoardEntry } from "./health-board";
import type { ProjectConfigRow } from "./services";

const HOUR_MS = 60 * 60_000;
const GRACE_MS = 15 * 60_000;

export type HazeHourlyEvidence = {
  checkedAt: string;
  runs: { projectCode: string; at: string }[];
};

/** The two most recent hourly slots whose 15-minute recording grace has elapsed. */
export function completedHazeHourlySlots(checkedAt: string): [string, string] | null {
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked)) return null;
  const newest = Math.floor((checked - GRACE_MS) / HOUR_MS) * HOUR_MS;
  return [new Date(newest - HOUR_MS).toISOString(), new Date(newest).toISOString()];
}

/** A run row, including a deliberate skip, proves the job reached this project. */
export function missingHazeHourlyEntries(rows: readonly ProjectConfigRow[], evidence: HazeHourlyEvidence | null): BoardEntry[] {
  if (!evidence) return [];
  const slots = completedHazeHourlySlots(evidence.checkedAt);
  if (!slots) return [];
  const observed = new Set(evidence.runs.flatMap(({ projectCode, at }) => {
    const timestamp = Date.parse(at);
    if (!projectCode || !Number.isFinite(timestamp)) return [];
    return [`${projectCode}|${Math.floor(timestamp / HOUR_MS) * HOUR_MS}`];
  }));
  return rows.flatMap((row) => {
    const projectCode = String(row.project_code ?? "").trim();
    if (!projectCode || row.enabled === false) return [];
    if (!String(row.wa_group_ids ?? "").split(",").some((group) => group.trim())) return [];
    // Current configuration cannot prove the project was enabled before a recent edit.
    const changedAt = Date.parse(String(row.updated_at ?? row.created_at ?? ""));
    if (Number.isFinite(changedAt) && changedAt > Date.parse(slots[0])) return [];
    if (slots.some((slot) => observed.has(`${projectCode}|${Date.parse(slot)}`))) return [];
    return [{
      service: "haze" as const,
      projectCode,
      signal: "run" as const,
      colour: "red" as const,
      label: "Scheduled hourly run missing for two consecutive hours",
      detail: slots[0],
      idle: false,
    }];
  });
}
