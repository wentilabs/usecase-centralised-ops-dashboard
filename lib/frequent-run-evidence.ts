import type { FrequentRunEvidence } from "./scheduled-run-health";

type Read = (path: string, schema: string) => Promise<{ ok: boolean; body: unknown }>;

const SOURCES = [
  { service: "wbgt", schema: "wbgts", table: "wbgt_job_runs", column: "job_type", filter: "eq.scrape-wbgt", job: "WBGT scrape" },
  { service: "ailytics", schema: "ailytics", table: "job_runs", column: "job_type", filter: "eq.yesterday_summary", job: "Ailytics hourly summary" },
  { service: "issueChaser", schema: "issue_chaser", table: "job_runs", column: "job_type", filter: "eq.severity_cadence_chaser", job: "Issue Chaser severity check" },
  // The live per-minute HTTP scheduler reaches /api/vibration-scrape and the
  // service records those calls as "manual". Direct EventBridge calls use "cron".
  { service: "vibration", schema: "vibration", table: "vibration_job_runs", column: "invocation_type", filter: "in.(cron,manual)", job: "Vibration scrape" },
] as const;

/** Read one newest-row baseline per recurring service job. */
export async function collectFrequentRunEvidence(checkedAt: string, read: Read): Promise<FrequentRunEvidence> {
  const sources = await Promise.all(SOURCES.map(async ({ service, schema, table, column, filter, job }) => {
    const query = new URLSearchParams({ select: "started_at", [column]: filter, order: "started_at.desc", limit: "1" });
    try {
      const result = await read(`${table}?${query}`, schema);
      if (!result.ok || !Array.isArray(result.body)) return { service, job, state: "unavailable" as const, latestAt: null };
      const latestAt = result.body[0]?.started_at;
      if (typeof latestAt !== "string" || !Number.isFinite(Date.parse(latestAt))) {
        return { service, job, state: "no_history" as const, latestAt: null };
      }
      return { service, job, state: "ready" as const, latestAt };
    } catch {
      return { service, job, state: "unavailable" as const, latestAt: null };
    }
  }));
  return { checkedAt, sources };
}
