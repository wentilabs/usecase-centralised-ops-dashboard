import { isServiceKey, type ServiceKey } from "./services";

export type HandlerFailure = {
  service: ServiceKey;
  at: string;
  route: string | null;
  reason: string;
};

export type HandlerFailureReport = {
  checkedAt: string;
  failures: HandlerFailure[];
  unavailable: boolean;
};

export function handlerFailureRows(rows: unknown): HandlerFailure[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    if (typeof value.service_key !== "string" || !isServiceKey(value.service_key) || typeof value.occurred_at !== "string" ||
        Number.isNaN(Date.parse(value.occurred_at)) || typeof value.reason !== "string" || !value.reason.trim()) return [];
    return [{
      service: value.service_key,
      at: value.occurred_at,
      route: typeof value.route === "string" ? value.route : null,
      reason: value.reason.slice(0, 500),
    }];
  });
}
