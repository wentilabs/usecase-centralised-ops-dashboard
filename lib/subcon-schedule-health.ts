import type { BoardEntry } from "./health-board";
import subconContract from "../contracts/services/subcon.contract.json";
import { readHealthSchedules, type HealthSchedule } from "./health-schedules";

type Schedule = HealthSchedule;

/** The service owns these UTC identities; the external scheduler must match them. */
export const SUBCON_SCHEDULES: readonly Schedule[] = readHealthSchedules(subconContract.health);

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
    if (!schedule.hours.includes(date.getUTCHours()) || !schedule.minutes.includes(date.getUTCMinutes())) continue;
    if (schedule.weekdays && !schedule.weekdays.includes(date.getUTCDay())) continue;
    if (schedule.monthDays && !schedule.monthDays.includes(date.getUTCDate())) continue;
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
