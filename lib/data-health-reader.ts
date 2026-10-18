import {
  assessIngestionHealth,
  healthKey,
  healthTarget,
  idleBecauseSkipped,
  type HealthTarget,
  type IngestionEvidence,
  type ProjectHealth,
} from "./data-health";
import { activityFor, type Activity } from "./data-health-activity";
import { isIdleStatus } from "./health-status";
import { runLogOf } from "./process-log";
import type { ProjectConfigRow, ServiceKey } from "./services";

const REQUEST_TIMEOUT_MS = 8_000;

type HealthReadOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
  url?: string;
  key?: string;
  timeoutMs?: number;
};

function config(options: HealthReadOptions) {
  const url = (options.url ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = options.key ?? process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  return { url, key };
}

function selectFor(target: HealthTarget): string {
  return target.service === "wbgt" ? "created_at,reading_timestamp" : "created_at,date,time_hhmm";
}

function sourceEventAt(target: HealthTarget, row: Record<string, unknown>): unknown {
  if (target.service === "wbgt") return row.reading_timestamp;
  const date = typeof row.date === "string" ? row.date : "";
  const time = typeof row.time_hhmm === "string" ? row.time_hhmm : "";
  return date && time ? `${date}T${time.length === 5 ? `${time}:00` : time}+08:00` : null;
}

async function newestEvidence(target: HealthTarget, options: Required<Pick<HealthReadOptions, "fetchImpl" | "now" | "timeoutMs">> & { url: string; key: string }): Promise<IngestionEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const query = new URLSearchParams({ select: selectFor(target), order: "created_at.desc", limit: "1" });
    const response = await options.fetchImpl(`${options.url}/rest/v1/${encodeURIComponent(target.table)}?${query}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: options.key,
        Authorization: `Bearer ${options.key}`,
        "Accept-Profile": target.schema,
      },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { code?: unknown } | null;
      return response.status === 404 && error?.code === "PGRST205" ? { kind: "missing_table" } : { kind: "monitor_error" };
    }
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) return { kind: "monitor_error" };
    if (!rows.length || !rows[0] || typeof rows[0] !== "object") return { kind: "empty" };
    const row = rows[0] as Record<string, unknown>;
    return { kind: "row", createdAt: row.created_at, sourceEventAt: sourceEventAt(target, row) };
  } catch {
    return { kind: "monitor_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Was the silence deliberate? Asked of the service's own run log.
 *
 * The age check asks "is the data old?", and answers a different question from
 * the one that matters: "SHOULD it have produced anything?". HALO models that
 * from the cadence hours in the configuration, which cannot know about a
 * calendar mute. ZRB mutes Sundays, its cadence windows cover this afternoon, and
 * Noise skips on purpose — `skipped_sunday_notifications_disabled`, every five
 * minutes — so no reading was ever going to arrive, and the card went red for a
 * service doing exactly what it was told.
 *
 * The run log is the testimony that settles it, and it cannot drift the way a
 * mirror of each service's calendar rules would: WBGT, for one, still scrapes on
 * a muted Sunday and mutes only the send.
 *
 * Explained when ALL of these hold, and not otherwise:
 *
 *   1. The PRODUCER has not run since the last reading, and nothing has failed.
 *      Not "no run at all": a five-minute alert run reading stored data, or a
 *      daily maintenance job, says nothing about whether readings are being
 *      produced — ZRB has both after its last reading. Only the scrape does. If
 *      the scrape ran and produced no reading, that is the fault this check
 *      exists to catch, and it stays red.
 *   2. The newest run is a deliberate skip. That is the service being alive and
 *      choosing not to work. No run at all is not an explanation: a silent cron
 *      is exactly what a stale verdict is for.
 *   3. No recent skip names a fault. `skipped_` normally means "not due", but a
 *      sheet that is not configured starts with it too; `isIdleStatus` already
 *      refuses to call that idle.
 *
 * Any failure to ask leaves the verdict as it was: not being able to check is
 * never a reason to clear a red.
 */
async function skippedSinceReading(
  target: HealthTarget,
  since: string,
  options: Required<Pick<HealthReadOptions, "fetchImpl" | "timeoutMs">> & { url: string; key: string },
): Promise<string | null> {
  const log = runLogOf(target.service);
  if (!log) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  const ask = async (params: Record<string, string>): Promise<string[] | null> => {
    const query = new URLSearchParams({
      select: log.statusColumn,
      [log.projectColumn]: `eq.${target.projectCode}`,
      order: `${log.timeColumn}.desc`,
      ...params,
    });
    // The reading time arrives already normalised to `…Z` form, so it contains no
    // `+` today. It is encoded anyway because it is a value being placed in a URL,
    // and PostgREST returns raw timestamps with a `+00:00` that a bare query
    // string would turn into a space. Defensive, not load-bearing.
    const url = `${options.url}/rest/v1/${encodeURIComponent(log.table)}?${query}&${log.timeColumn}=gt.${encodeURIComponent(since)}`;
    const response = await options.fetchImpl(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { apikey: options.key, Authorization: `Bearer ${options.key}`, "Accept-Profile": log.schema },
    });
    if (!response.ok) return null;
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => String((row as Record<string, unknown>)?.[log.statusColumn] ?? "").trim());
  };

  try {
    const [producerOrFailure, newest] = await Promise.all([
      // Since the reading: has the producer run, or has anything failed?
      ask({
        or: `(${log.producer.jobTypeColumn}.like.${log.producer.jobTypePrefix}*,${log.statusColumn}.like.failed*)`,
        limit: "1",
      }),
      // The latest runs, to see what the service is doing now.
      ask({ limit: "6" }),
    ]);
    if (!producerOrFailure || !newest) return null; // could not ask: leave the red
    if (producerOrFailure.length) return null; // the producer worked, or something failed
    const [latest] = newest;
    if (!latest || !isIdleStatus(latest)) return null; // not clearly a deliberate skip
    // A skip that names a fault, among the recent ones.
    if (newest.some((status) => status.toLowerCase().startsWith("skipped") && !isIdleStatus(status))) return null;
    return latest;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads only catalog-derived source tables; the server-only wrapper exposes it to HALO. */
export async function listProjectHealth(
  configured: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  options: HealthReadOptions = {},
): Promise<Map<string, ProjectHealth>> {
  const { url, key } = config(options);
  const readOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? new Date(),
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    url,
    key,
  };
  // The row travels with its target: the verdict needs to know what this
  // project is supposed to be doing right now, and only the row can say.
  const targets = (["wbgt", "noise"] as const).flatMap((service) =>
    (configured[service] ?? []).flatMap((row) => {
      const target = healthTarget(service, String(row.project_code ?? ""));
      return target ? [{ target, activity: activityFor(service, row, readOptions.now) }] : [];
    }),
  );
  /**
   * An idle project is not queried at all.
   *
   * Its verdict does not depend on the evidence — nothing is expected of it, so
   * nothing about its table can be wrong — and skipping it removes most of the
   * estate's requests outside site hours, which is when this runs most often.
   */
  const reads = await Promise.allSettled(
    targets.map(async ({ target, activity }) =>
      activity.state === "active"
        ? { evidence: await newestEvidence(target, readOptions) }
        : { evidence: { kind: "skipped" } as unknown as IngestionEvidence },
    ),
  );
  const health = new Map<string, ProjectHealth>();

  const verdicts = await Promise.all(reads.map(async (read, index) => {
    const { target, activity } = targets[index];
    const evidence = read.status === "fulfilled" ? read.value.evidence : { kind: "monitor_error" as const };
    const verdict = assessIngestionHealth(target, evidence, readOptions.now, activity);

    // Asked ONLY when the age check is about to report a problem, so a healthy
    // estate pays nothing and the request count for a quiet day is unchanged.
    // `evidence.kind === "row"` because the question is "since the last reading",
    // and a project with no reading has no such moment to ask about.
    if ((verdict.tone === "warn" || verdict.tone === "danger") && evidence.kind === "row" && verdict.newestReceivedAt) {
      const skipped = await skippedSinceReading(target, verdict.newestReceivedAt, readOptions);
      if (skipped) return { target, verdict: idleBecauseSkipped(verdict, skipped) };
    }
    return { target, verdict };
  }));
  for (const { target, verdict } of verdicts) health.set(healthKey(target.service, target.projectCode), verdict);
  return health;
}
