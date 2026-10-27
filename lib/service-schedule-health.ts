import type { BoardEntry } from "./health-board";
import type { ServiceKey } from "./services";
import { serviceContractFor } from "./service-contracts";
import { readHealthSchedules } from "./health-schedules";
import { completedNoiseTicks } from "./noise-schedule-health";

export const SCHEDULE_SERVICES = ["haze", "wbgt", "ailytics", "issueChaser", "lightning", "vibration"] as const;
type ScheduledService = typeof SCHEDULE_SERVICES[number];
export type ServiceScheduleEvidence = { checkedAt: string; sources: { service: ScheduledService; state: "ready" | "unavailable"; routes: { route: string; method: string; lastFinishedAt: string }[] }[] };
// Existing more specific checks cover these routes; avoid duplicate issues.
const covered = new Set(["ailytics:/ailytics-safety/yesterday-24h-summary", "issueChaser:/api/issue-chaser-severity-cadence", "vibration:/api/vibration-scrape", "lightning:/api/lightning-tick"]);
export function scheduleCoverage(evidence: ServiceScheduleEvidence | null) {
  const unavailable: string[] = [], pending: string[] = [], shared: string[] = [];
  for (const service of SCHEDULE_SERVICES) {
    const schedules = readHealthSchedules(serviceContractFor(service)?.health);
    const source = evidence?.sources.find((item) => item.service === service);
    if (!source || source.state !== "ready") { unavailable.push(service); continue; }
    for (const rule of schedules) {
      const method = rule.method ?? "POST";
      if (schedules.filter((other) => other.route === rule.route && (other.method ?? "POST") === method).length > 1) { shared.push(`${service}: ${rule.name}`); continue; }
      if (covered.has(`${service}:${rule.route}`)) continue;
      if (!source.routes.some((row) => row.route === rule.route && row.method === method)) pending.push(`${service}: ${rule.name}`);
    }
  }
  return { unavailable, pending, shared };
}
export function missingServiceScheduleEntries(evidence: ServiceScheduleEvidence | null): BoardEntry[] {
  if (!evidence) return [];
  return evidence.sources.flatMap((source) => {
    if (source.state !== "ready") return [];
    const schedules = readHealthSchedules(serviceContractFor(source.service)?.health);
    return schedules.flatMap((rule) => {
      const method = rule.method ?? "POST";
      if (covered.has(`${source.service}:${rule.route}`) || schedules.filter((other) => other.route === rule.route && (other.method ?? "POST") === method).length > 1) return [];
      const row = source.routes.find((item) => item.route === rule.route && item.method === method);
      const last = row ? Date.parse(row.lastFinishedAt) : NaN;
      const ticks = completedNoiseTicks(evidence.checkedAt, rule);
      if (!Number.isFinite(last) || !ticks || last >= Date.parse(ticks[0])) return [];
      return [{ service: source.service as ServiceKey, projectCode: rule.route, scope: "service" as const, signal: "run" as const, colour: "red" as const, label: `${rule.name} has no recorded route completion after two scheduled UTC runs`, detail: `Last recorded route completion: ${new Date(last).toISOString()}. Manual invocations also count.`, idle: false }];
    });
  });
}
