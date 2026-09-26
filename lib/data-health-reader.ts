import {
  assessIngestionHealth,
  healthKey,
  healthTarget,
  type HealthTarget,
  type IngestionEvidence,
  type ProjectHealth,
} from "./data-health";
import { activityFor, type Activity } from "./data-health-activity";
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

  reads.forEach((read, index) => {
    const { target, activity } = targets[index];
    const evidence = read.status === "fulfilled" ? read.value.evidence : { kind: "monitor_error" as const };
    health.set(
      healthKey(target.service, target.projectCode),
      assessIngestionHealth(target, evidence, readOptions.now, activity),
    );
  });
  return health;
}
