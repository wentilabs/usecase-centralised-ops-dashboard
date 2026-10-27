import type { BoardEntry } from "./health-board";

type Schedule = { route: string; name: string; minutes: readonly number[]; hours: readonly number[]; weekdays?: readonly number[]; monthDays?: readonly number[] };
const allHours = Array.from({ length: 24 }, (_, hour) => hour);
const everyFive = (offset: number) => Array.from({ length: 12 }, (_, index) => offset + index * 5);
const at = (route: string, name: string, minutes: readonly number[], hours: readonly number[] = allHours, extra: Partial<Schedule> = {}): Schedule => ({ route, name, minutes, hours, ...extra });

/** Verified against the live scheduler screenshot supplied 27 Oct 2026; times are UTC. */
export const NOISE_SCHEDULES: readonly Schedule[] = [
  at("/api/halo-data-health", "HALO health alerts", everyFive(0)),
  at("/api/noise-data-health", "Noise Data Health", Array.from({ length: 60 }, (_, minute) => minute)),
  at("/api/noise-hourly-app-screenshot", "Noise meter app screenshot", [0]),
  at("/api/noise-monthly-report", "Noise Monthly Excel Report", [45], [4], { monthDays: [1] }),
  at("/api/noise-15min-average-exceedance", "Noise 15 minute average", [17, 32, 47]),
  at("/api/noise-evening-summary", "Noise Evening Summary", [0], [11]),
  at("/api/noise-7am-7pm-leq12hr-table", "Noise hourly Leq12hr table", [3], Array.from({ length: 12 }, (_, hour) => hour)),
  at("/api/noise-limit-refresh", "Noise Limits Refresh", [0], [2], { weekdays: [0] }),
  at("/api/noise-sunday-leq12hr-hourly", "Noise Sunday Leq12hr hourly", [3], Array.from({ length: 12 }, (_, hour) => hour), { weekdays: [0, 6] }),
  at("/api/noise-morning-summary", "Noise Morning Summary", [0], [23]),
  at("/api/noise-3hour-summary", "Noise 3H summaries", [3], [2, 5, 8, 11]),
  at("/api/noise-sheet-sync", "Noise sheet sync", [5], [15]),
  at("/api/scrape-noiselynx", "Scrape Noise Data", everyFive(2)),
  at("/api/noise-hourly", "Noise Reading Hourly", [4]),
  at("/api/noise-half-hourly", "Noise Reading Half-Hourly", everyFive(3)),
  at("/api/noise-5min", "Noise Reading 5min", everyFive(3)),
];

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
