import { noiseTableForProject, wbgtTableForProject } from "./onboarding/naming";
import type { ServiceKey } from "./services";

export type HealthTone = "good" | "warn" | "danger" | "neutral";
export type DeliveryOutcome = "provider_accepted" | "provider_pending" | "transport_failed" | "device_delivered" | "read" | "not_monitored";

export type HealthTarget = {
  service: "wbgt" | "noise";
  projectCode: string;
  schema: "wbgts" | "noise-meters";
  table: string;
  warningAfterMs: number;
  criticalAfterMs: number;
  sourceTimeFields: string[];
};

export type IngestionEvidence =
  | { kind: "row"; createdAt: unknown; sourceEventAt?: unknown }
  | { kind: "empty" }
  | { kind: "missing_table" }
  | { kind: "monitor_error" };

export type ProjectHealth = {
  service: ServiceKey;
  projectCode: string;
  tone: HealthTone;
  label: string;
  newestReceivedAt: string | null;
  sourceEventAt: string | null;
};

const HOUR = 60 * 60 * 1000;

export function healthKey(service: ServiceKey, projectCode: string): string {
  return JSON.stringify([service, String(projectCode).trim()]);
}

export function healthTarget(service: ServiceKey, projectCode: string): HealthTarget | null {
  const trimmed = String(projectCode).trim();
  if (!trimmed) return null;

  if (service === "wbgt") {
    const table = wbgtTableForProject(trimmed);
    if (!hasSafeTableStem(table, "_wbgt_data_hourly")) return null;
    return {
      service,
      projectCode: trimmed,
      schema: "wbgts",
      table,
      warningAfterMs: 1 * HOUR,
      criticalAfterMs: 4 * HOUR,
      sourceTimeFields: ["reading_timestamp"],
    };
  }

  if (service === "noise") {
    const table = noiseTableForProject(trimmed);
    if (!hasSafeTableStem(table, "_noise_data_daily")) return null;
    return {
      service,
      projectCode: trimmed,
      schema: "noise-meters",
      table,
      warningAfterMs: 1 * HOUR,
      criticalAfterMs: 4 * HOUR,
      sourceTimeFields: ["date", "time_hhmm"],
    };
  }

  return null;
}

function hasSafeTableStem(table: string, suffix: string): boolean {
  const stem = table.slice(0, -suffix.length);
  return /^[a-z][a-z0-9_]*$/.test(stem);
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function result(target: HealthTarget, tone: HealthTone, label: string, newestReceivedAt: string | null, sourceEventAt: string | null): ProjectHealth {
  return {
    service: target.service,
    projectCode: target.projectCode,
    tone,
    label,
    newestReceivedAt,
    sourceEventAt,
  };
}

export function neutralHealth(service: ServiceKey, projectCode: string): ProjectHealth {
  return {
    service,
    projectCode: String(projectCode).trim(),
    tone: "neutral",
    label: "Data: not yet covered",
    newestReceivedAt: null,
    sourceEventAt: null,
  };
}

export function dataHealthDetail(health: ProjectHealth | undefined): string {
  if (!health) return "Monitoring is automatic. This service is not yet covered by the pilot.";
  return health.newestReceivedAt
    ? "Monitoring is automatic. This project is covered."
    : "Monitoring is automatic. This project is covered; no receipt timestamp is available.";
}

export function assessIngestionHealth(target: HealthTarget, evidence: IngestionEvidence, now: Date): ProjectHealth {
  if (evidence.kind === "empty") return result(target, "danger", "Data: no data received yet", null, null);
  if (evidence.kind === "missing_table") return result(target, "danger", "Data: table unavailable", null, null);
  if (evidence.kind === "monitor_error") return result(target, "danger", "Data: monitor unavailable", null, null);

  const newestReceivedAt = parseTimestamp(evidence.createdAt);
  const sourceEventAt = parseTimestamp(evidence.sourceEventAt);
  if (!newestReceivedAt) return result(target, "neutral", "Data: receipt time unavailable", null, sourceEventAt);

  const ageMs = now.getTime() - new Date(newestReceivedAt).getTime();
  if (ageMs < 0) return result(target, "neutral", "Data: receipt time is in the future", newestReceivedAt, sourceEventAt);
  if (ageMs >= target.criticalAfterMs) return result(target, "danger", "Data: no recent data", newestReceivedAt, sourceEventAt);
  if (ageMs >= target.warningAfterMs) return result(target, "warn", "Data: delayed", newestReceivedAt, sourceEventAt);
  return result(target, "good", "Data: receiving", newestReceivedAt, sourceEventAt);
}

export function healthBadge(outcome: DeliveryOutcome): { tone: HealthTone; label: string } {
  if (outcome === "provider_accepted") return { tone: "good", label: "Delivery: Provider accepted" };
  if (outcome === "device_delivered") return { tone: "good", label: "Delivery: Delivered" };
  if (outcome === "read") return { tone: "good", label: "Delivery: Read" };
  if (outcome === "transport_failed") return { tone: "danger", label: "Delivery: failed" };
  if (outcome === "provider_pending") return { tone: "warn", label: "Delivery: pending" };
  return { tone: "neutral", label: "Delivery: not monitored" };
}
