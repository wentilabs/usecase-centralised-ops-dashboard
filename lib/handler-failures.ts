import { isServiceKey, type ServiceKey } from "./services";

export type HandlerFailure = {
  service: ServiceKey;
  at: string;
  route: string | null;
  projectCode: string | null;
  eventType: "handler_failure" | "run_failure" | "delivery_failure";
  reason: string;
};

export type HandlerFailureReport = {
  checkedAt: string;
  failures: HandlerFailure[];
  sources: { service: ServiceKey; state: "ready" | "legacy" | "partial" | "unavailable" }[];
};

export function handlerFailureRows(service: ServiceKey, rows: unknown, legacy = false): HandlerFailure[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    if (legacy && (typeof value.service_key !== "string" || !isServiceKey(value.service_key) || value.service_key !== service)) return [];
    if (typeof value.occurred_at !== "string" ||
        Number.isNaN(Date.parse(value.occurred_at)) || typeof value.reason !== "string" || !value.reason.trim()) return [];
    return [{
      service,
      at: value.occurred_at,
      route: typeof value.route === "string" ? value.route : null,
      projectCode: typeof value.project_code === "string" ? value.project_code : null,
      eventType: value.event_type === "run_failure" || value.event_type === "delivery_failure" ? value.event_type : "handler_failure",
      reason: value.reason.slice(0, 500),
    }];
  });
}

/** Vibration's estate-wide run log retains individual sanitized source failures in details.errors. */
export function vibrationRunFailureRows(rows: unknown): HandlerFailure[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const at = value.started_at;
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return [];
    const details = value.details && typeof value.details === "object" ? value.details as Record<string, unknown> : {};
    const errors = Array.isArray(details.errors) ? details.errors : [];
    const failures = errors.flatMap((error) => {
      if (!error || typeof error !== "object") return [];
      const item = error as Record<string, unknown>;
      const reason = typeof item.message === "string" ? item.message.trim() : "";
      if (!reason) return [];
      return [{ service: "vibration" as const, at, route: "vibration-scrape", projectCode: typeof item.project_code === "string" ? item.project_code : null,
        eventType: "run_failure" as const, reason: reason.slice(0, 500) }];
    });
    if (failures.length) return failures;
    const reason = typeof value.error_message === "string" && value.error_message.trim()
      ? value.error_message.trim() : value.status === "partial" ? "Partial scrape; source details unavailable" : "Vibration scrape failed";
    return [{ service: "vibration" as const, at, route: "vibration-scrape", projectCode: null,
      eventType: "run_failure" as const, reason: reason.slice(0, 500) }];
  });
}
