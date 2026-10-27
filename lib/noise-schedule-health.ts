import type { BoardEntry } from "./health-board";
import noiseContract from "../contracts/services/noise.contract.json";
import { readHealthSchedules, type HealthSchedule } from "./health-schedules";

type Schedule = HealthSchedule;
/** The service owns these UTC identities; the external scheduler must match them. */
export const NOISE_SCHEDULES: readonly Schedule[] = readHealthSchedules(noiseContract.health);

export type NoiseScheduleEvidence = {
  checkedAt: string;
  state: "ready" | "unavailable";
  routes: { route: string; lastSeenAt: string }[];
};

const GRACE_MS = 15 * 60_000;
const MINUTE_MS = 60_000;
const MAX_LOOKBACK_MINUTES = 70 * 24 * 60;

/** Two most recent UTC due times with enough time for a handler to return. */
export function completedNoiseTicks(checkedAt: string, schedule: Schedule): [string, string] | null {
  const now = Date.parse(checkedAt);
  if (!Number.isFinite(now)) return null;
  const start = Math.floor((now - GRACE_MS) / MINUTE_MS) * MINUTE_MS;
  const found: string[] = [];
  for (let i = 0; i < MAX_LOOKBACK_MINUTES && found.length < 2; i++) {
    const date = new Date(start - i * MINUTE_MS);
    if (!schedule.minutes.includes(date.getUTCMinutes()) || !schedule.hours.includes(date.getUTCHours())) continue;
    if (schedule.weekdays && !schedule.weekdays.includes(date.getUTCDay())) continue;
    if (schedule.monthDays && !schedule.monthDays.includes(date.getUTCDate())) continue;
    found.push(date.toISOString());
  }
  return found.length === 2 ? [found[1], found[0]] : null;
}

export function missingNoiseScheduleEntries(evidence: NoiseScheduleEvidence | null): BoardEntry[] {
  if (!evidence || evidence.state !== "ready") return [];
  const observed = new Map(evidence.routes.map(({ route, lastSeenAt }) => [route, Date.parse(lastSeenAt)]));
  return NOISE_SCHEDULES.flatMap((schedule) => {
    const latest = observed.get(schedule.route);
    if (latest === undefined || !Number.isFinite(latest)) return []; // No baseline yet.
    const ticks = completedNoiseTicks(evidence.checkedAt, schedule);
    if (!ticks || latest >= Date.parse(ticks[0])) return [];
    return [{
      service: "noise" as const,
      projectCode: schedule.route,
      scope: "service" as const,
      signal: "run" as const,
      colour: "red" as const,
      label: `${schedule.name} has no recorded completion after two scheduled UTC runs`,
      detail: `Last recorded completion: ${new Date(latest).toISOString()}`,
      idle: false,
    }];
  });
}
