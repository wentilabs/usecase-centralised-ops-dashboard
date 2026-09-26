import { isServiceKey, type ServiceKey } from "./services";

export type DataCheck = "staleness" | "volume_trend";
export type DeliveryCheck = "expected_attempt" | "provider_acceptance" | "receipt";
export type HealthTone = "good" | "warn" | "danger" | "neutral";
export type DeliveryOutcome = "provider_accepted" | "provider_pending" | "transport_failed" | "device_delivered" | "read" | "not_monitored";

export type HealthPolicyDraft = {
  canonical_project_id: string;
  source_service: ServiceKey;
  enabled: boolean;
  data_checks: DataCheck[];
  delivery_checks: DeliveryCheck[];
  sensitivity: "relaxed" | "standard" | "strict";
  recipient_group_ids: string[];
  notification_cooldown_minutes: number;
  notify_on_recovery: boolean;
  muted_until: string | null;
};

export type HealthPolicy = HealthPolicyDraft & { id: string; project_code: string; created_at: string; updated_at: string };
export type HealthSnapshot = { policy_id: string; data_outcome: HealthTone; delivery_outcome: DeliveryOutcome | null; evaluated_at: string | null };
export type DataHealthAvailability = { available: boolean; reason: "ready" | "not_configured" | "unreachable" };

const DATA_CHECKS = new Set<DataCheck>(["staleness", "volume_trend"]);
const DELIVERY_CHECKS = new Set<DeliveryCheck>(["expected_attempt", "provider_acceptance", "receipt"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function list(values: unknown, allowed: Set<string>) {
  return Array.isArray(values) ? [...new Set(values.map((value) => String(value).trim()).filter((value) => allowed.has(value)))] : [];
}

export function defaultHealthPolicyDraft(): HealthPolicyDraft {
  return { canonical_project_id: "", source_service: "wbgt", enabled: false, data_checks: ["staleness", "volume_trend"], delivery_checks: ["expected_attempt", "provider_acceptance"], sensitivity: "standard", recipient_group_ids: [], notification_cooldown_minutes: 360, notify_on_recovery: true, muted_until: null };
}

export function validateHealthPolicyDraft(input: unknown): { draft: HealthPolicyDraft | null; problems: string[] } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const base = defaultHealthPolicyDraft();
  const draft: HealthPolicyDraft = {
    canonical_project_id: String(value.canonical_project_id ?? "").trim(),
    source_service: String(value.source_service ?? base.source_service) as ServiceKey,
    enabled: value.enabled === true,
    data_checks: list(value.data_checks ?? base.data_checks, DATA_CHECKS) as DataCheck[],
    delivery_checks: list(value.delivery_checks ?? base.delivery_checks, DELIVERY_CHECKS) as DeliveryCheck[],
    sensitivity: ["relaxed", "standard", "strict"].includes(String(value.sensitivity ?? base.sensitivity)) ? String(value.sensitivity ?? base.sensitivity) as HealthPolicyDraft["sensitivity"] : base.sensitivity,
    recipient_group_ids: Array.isArray(value.recipient_group_ids) ? [...new Set(value.recipient_group_ids.map((id) => String(id).trim()).filter(Boolean))] : [],
    notification_cooldown_minutes: Number.isInteger(value.notification_cooldown_minutes) && Number(value.notification_cooldown_minutes) >= 0 ? Number(value.notification_cooldown_minutes) : base.notification_cooldown_minutes,
    notify_on_recovery: value.notify_on_recovery !== false,
    muted_until: typeof value.muted_until === "string" && value.muted_until.trim() ? value.muted_until : null,
  };
  const problems: string[] = [];
  if (!UUID.test(draft.canonical_project_id)) problems.push("Choose a canonical project.");
  if (!isServiceKey(draft.source_service)) problems.push("Choose a HALO source service.");
  if (draft.enabled && !draft.recipient_group_ids.length) problems.push("Choose at least one operations recipient before enabling.");
  if (draft.enabled && !draft.data_checks.length && !draft.delivery_checks.length) problems.push("Choose at least one data or delivery check before enabling.");
  return { draft: problems.length ? null : draft, problems };
}

export function healthBadge(outcome: DeliveryOutcome): { tone: HealthTone; label: string } {
  if (outcome === "provider_accepted") return { tone: "good", label: "Delivery: Provider accepted" };
  if (outcome === "device_delivered") return { tone: "good", label: "Delivery: Delivered" };
  if (outcome === "read") return { tone: "good", label: "Delivery: Read" };
  if (outcome === "transport_failed") return { tone: "danger", label: "Delivery: failed" };
  if (outcome === "provider_pending") return { tone: "warn", label: "Delivery: pending" };
  return { tone: "neutral", label: "Delivery: not monitored" };
}

export function dataHealthAvailability(error?: unknown): DataHealthAvailability {
  if (!error) return { available: true, reason: "ready" };
  return { available: false, reason: /PGRST106|406|schema/i.test(error instanceof Error ? error.message : String(error)) ? "not_configured" : "unreachable" };
}

export function latestSnapshots(rows: Array<HealthSnapshot>): Map<string, HealthSnapshot> {
  return rows.reduce((latest, row) => {
    const previous = latest.get(row.policy_id);
    if (!previous || String(row.evaluated_at ?? "") > String(previous.evaluated_at ?? "")) latest.set(row.policy_id, row);
    return latest;
  }, new Map<string, HealthSnapshot>());
}
