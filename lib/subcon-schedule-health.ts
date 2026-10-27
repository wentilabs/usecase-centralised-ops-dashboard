import type { BoardEntry } from "./health-board";

type Schedule = { key: string; route: string; name: string; hour: number; minute: number; weekday?: number };

/** Six live Subcon scheduler rules supplied 27 Oct 2026; times treated as UTC. */
export const SUBCON_SCHEDULES: readonly Schedule[] = [
  { key: "housekeeping-photos-saturday-2000", route: "/refresh-housekeeping-photos", name: "Housekeeping photo refresh", hour: 20, minute: 0, weekday: 6 },
  { key: "housekeeping-sheet-1545", route: "/daily-housekeeping-sheet", name: "Nightly housekeeping sheet", hour: 15, minute: 45 },
  { key: "manpower-summary-0805", route: "/daily-manpower-summary", name: "4PM manpower summary", hour: 8, minute: 5 },
  { key: "activity-summary-0405", route: "/daily-activity-summary", name: "Activity summary", hour: 4, minute: 5 },
  { key: "manpower-summary-0205", route: "/daily-manpower-summary", name: "Manpower summary", hour: 2, minute: 5 },
  { key: "housekeeping-report-1410", route: "/daily-housekeeping-report", name: "Housekeeping nightly reminder", hour: 14, minute: 10 },
];

export type SubconScheduleEvidence = {
  checkedAt: string;
  state: "ready" | "unavailable";
  schedules: { scheduleKey: string; lastStartedAt: string }[];
};

const MINUTE_MS = 60_000;
const GRACE_MS = 15 * MINUTE_MS;
const MAX_LOOKBACK_MINUTES = 16 * 24 * 60;

/** Two most recent completed due times in UTC, allowing a handler 15 minutes. */
export function completedSubconTicks(checkedAt: string, schedule: Schedule): [string, string] | null {
  const now = Date.parse(checkedAt);
  if (!Number.isFinite(now)) return null;
  const start = Math.floor((now - GRACE_MS) / MINUTE_MS) * MINUTE_MS;
  const found: string[] = [];
  for (let i = 0; i < MAX_LOOKBACK_MINUTES && found.length < 2; i++) {
    const date = new Date(start - i * MINUTE_MS);
    if (date.getUTCHours() !== schedule.hour || date.getUTCMinutes() !== schedule.minute) continue;
    if (schedule.weekday !== undefined && date.getUTCDay() !== schedule.weekday) continue;
    found.push(date.toISOString());
  }
  return found.length === 2 ? [found[1], found[0]] : null;
}

export function missingSubconScheduleEntries(evidence: SubconScheduleEvidence | null): BoardEntry[] {
  if (!evidence || evidence.state !== "ready") return [];
  const observed = new Map(evidence.schedules.map(({ scheduleKey, lastStartedAt }) => [scheduleKey, Date.parse(lastStartedAt)]));
  return SUBCON_SCHEDULES.flatMap((schedule) => {
    const latest = observed.get(schedule.key);
    if (latest === undefined || !Number.isFinite(latest)) return [];
    const ticks = completedSubconTicks(evidence.checkedAt, schedule);
    if (!ticks || latest >= Date.parse(ticks[0])) return [];
    return [{
      service: "subcon" as const,
      projectCode: schedule.key,
      scope: "service" as const,
      signal: "run" as const,
      colour: "red" as const,
      label: `${schedule.name} has no recorded invocation after two scheduled UTC runs`,
      detail: `Last recorded start: ${new Date(latest).toISOString()}`,
      idle: false,
    }];
  });
}
