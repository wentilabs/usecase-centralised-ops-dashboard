import "server-only";

import { handlerFailureRows, vibrationRunFailureRows, type HandlerFailureReport } from "./handler-failures";
import { SERVICES, SERVICE_KEYS } from "./services";

type ReadResult = { ok: boolean; status: number; rows: unknown };

async function readRows(url: string, key: string, schema: string, path: string): Promise<ReadResult> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": schema },
  });
  return { ok: response.ok, status: response.status, rows: response.ok ? await response.json() : null };
}

/** Read service-owned sources independently. A failed source is never empty evidence. */
export async function listHandlerFailures(): Promise<HandlerFailureReport> {
  const checkedAt = new Date().toISOString();
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) return {
    checkedAt, failures: [], sources: SERVICE_KEYS.map((service) => ({ service, state: "unavailable" })),
  };
  const since = new Date(Date.parse(checkedAt) - 48 * 60 * 60_000).toISOString();
  const suffix = `occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=101`;
  const vibrationRunsPromise = readRows(url, key, "vibration",
    `vibration_job_runs?select=status,error_message,details,started_at&status=in.(partial,failed)&started_at=gte.${encodeURIComponent(since)}&order=started_at.desc&limit=101`)
    .catch(() => ({ ok: false, status: 0, rows: null }));
  const results = await Promise.all(SERVICE_KEYS.map(async (service) => {
    const legacyPromise = readRows(url, key, "ops", `service_handler_failures?select=service_key,route,reason,occurred_at&service_key=eq.${encodeURIComponent(service)}&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=101`)
      .catch(() => ({ ok: false, status: 0, rows: null }));
    try {
      const result = await readRows(url, key, SERVICES[service].schema,
        `service_health_events?select=event_type,route,project_code,reason,occurred_at&${suffix}`);
      return { service, result, legacy: await legacyPromise };
    } catch {
      return { service, result: { ok: false, status: 0, rows: null }, legacy: await legacyPromise };
    }
  }));
  const failures = [] as HandlerFailureReport["failures"];
  const sources = [] as HandlerFailureReport["sources"];
  for (const { service, result, legacy } of results) {
    const ownedRows = Array.isArray(result.rows) ? result.rows : [];
    const legacyRows = Array.isArray(legacy.rows) ? legacy.rows : [];
    if (result.ok) failures.push(...handlerFailureRows(service, ownedRows.slice(0, 100)));
    // During rollout, old invocations can have written only to ops even when
    // the new table now exists. Read both sources, not just a fallback.
    if (legacy.ok) failures.push(...handlerFailureRows(service, legacyRows.slice(0, 100), true));
    if (result.ok) {
      sources.push({ service, state: ownedRows.length > 100 || (legacy.ok && legacyRows.length > 100) ? "partial" : "ready" });
    } else if (legacy.ok) {
      sources.push({ service, state: result.status === 404 || result.status === 406 ? "legacy" : "partial" });
    } else {
      sources.push({ service, state: "unavailable" });
    }
  }
  const vibrationRuns = await vibrationRunsPromise;
  if (vibrationRuns.ok && Array.isArray(vibrationRuns.rows)) {
    failures.push(...vibrationRunFailureRows(vibrationRuns.rows.slice(0, 100)));
    const source = sources.find((entry) => entry.service === "vibration");
    if (source && vibrationRuns.rows.length > 100) source.state = "partial";
  } else {
    const source = sources.find((entry) => entry.service === "vibration");
    if (source && source.state === "ready") source.state = "partial";
  }
  // Each source is already bounded. A global limit lets one noisy service hide
  // every other service, even when their own reads completed successfully.
  return { checkedAt, failures: failures.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), sources };
}
