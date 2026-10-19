import { noiseTableForProject, wbgtTableForProject } from "./onboarding/naming";
import { activityLabel, type Activity } from "./data-health-activity";
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
  /**
   * Why an amber or red says what it says, one fact per line.
   *
   * A colour with nothing behind it tells a developer something is wrong and
   * nothing about where to look, which is how a red becomes a colour people learn
   * to ignore. Every warn/danger carries what was EXPECTED, what was SEEN, and —
   * added by the reader, which can ask — what the service itself said about it.
   * Plain sentences, never values from the data.
   */
  evidence?: string[];
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

function result(
  target: HealthTarget,
  tone: HealthTone,
  label: string,
  newestReceivedAt: string | null,
  sourceEventAt: string | null,
  evidence?: string[],
): ProjectHealth {
  return {
    service: target.service,
    projectCode: target.projectCode,
    tone,
    label,
    newestReceivedAt,
    sourceEventAt,
    ...(evidence?.length ? { evidence } : {}),
  };
}

/** "8–11, 13–19" from the hours a project works in. */
export function describeHours(hours: number[]): string {
  const runs: string[] = [];
  let start = 0;
  for (let index = 1; index <= hours.length; index += 1) {
    if (index < hours.length && hours[index] === hours[index - 1] + 1) continue;
    runs.push(hours[start] === hours[index - 1] ? `${hours[start]}` : `${hours[start]}–${hours[index - 1]}`);
    start = index;
  }
  return runs.join(", ");
}

/** "52 min", "5 h", "2 days". Coarse on purpose: it is read, not computed with. */
export function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${Math.max(minutes, 1)} min`;
  const hours = Math.round(ms / HOUR);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
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

/**
 * @param activity What the project is supposed to be doing right now. Outside a
 * cadence window there is nothing to judge, and an age-only verdict reports a
 * site that stopped exactly as configured as though it had broken. Omitted, the
 * assessment falls back to the target's fixed budgets — which is only correct
 * for a caller that knows the project is active.
 */
export function assessIngestionHealth(
  target: HealthTarget,
  evidence: IngestionEvidence,
  now: Date,
  activity?: Activity,
): ProjectHealth {
  // Nothing is expected, so nothing is wrong. This is checked before the
  // evidence, deliberately: a dormant project's table is legitimately empty,
  // and "no data received yet" on a project nothing asks of is a false alarm
  // rather than a softer one.
  const idle = activity ? activityLabel(activity) : null;
  if (idle) return result(target, "neutral", idle, null, null);

  if (evidence.kind === "empty") {
    return result(target, "danger", "Data: no data received yet", null, null, [
      `Seen: the table ${target.schema}.${target.table} exists and has no rows.`,
    ]);
  }
  if (evidence.kind === "missing_table") {
    return result(target, "danger", "Data: table unavailable", null, null, [
      `Seen: ${target.schema}.${target.table} does not exist, so no reading can have been stored for this project.`,
    ]);
  }
  if (evidence.kind === "monitor_error") {
    // Amber, not red: HALO failing to read says nothing about the project, so it is
    // not a fault of the site. Not green either — neutral renders green here, and
    // a project HALO could not look at must never read as healthy. The evidence
    // line says the problem is the reading, not the project.
    return result(target, "warn", "Data: monitor unavailable", null, null, [
      "Seen: HALO could not read the table (a timeout or an error), so nothing about the project was judged.",
    ]);
  }

  const newestReceivedAt = parseTimestamp(evidence.createdAt);
  const sourceEventAt = parseTimestamp(evidence.sourceEventAt);
  if (!newestReceivedAt) return result(target, "neutral", "Data: receipt time unavailable", null, sourceEventAt);

  const ageMs = now.getTime() - new Date(newestReceivedAt).getTime();
  if (ageMs < 0) return result(target, "neutral", "Data: receipt time is in the future", newestReceivedAt, sourceEventAt);

  /**
   * The configuration's own answer to "how long is too long", where available.
   *
   * A project running every hour of a site day tolerates an hour; one that
   * reports once a day tolerates a day, and judging that at the flat one-hour
   * budget called it broken for twenty-three hours out of twenty-four. The
   * fixed budgets remain the fallback for a caller with no activity to pass.
   */
  const warnAfter = activity?.state === "active" ? activity.toleranceMs : target.warningAfterMs;
  const criticalAfter = activity?.state === "active" ? activity.toleranceMs * 2 : target.criticalAfterMs;

  const sgtMidnight = Math.floor((now.getTime() + 8 * HOUR) / (24 * HOUR)) * 24 * HOUR - 8 * HOUR;
  if (activity?.state === "active" && activity.mutedDay && new Date(newestReceivedAt).getTime() < sgtMidnight) {
    // The site does not work today and nothing has arrived today, so silence is
    // the expected state and not a finding. Neutral rather than green, because
    // nothing was received; a reading that DID arrive today is judged normally.
    return result(target, "neutral", `Data: idle — ${activity.mutedDay} is muted`, newestReceivedAt, sourceEventAt);
  }

  // What the reader was told to expect and what it saw, written out, so the
  // colour is never the only thing a developer is handed.
  const reasons = [
    activity?.state === "active"
      ? `Expected: ${activity.cadence} in hours ${describeHours(activity.activeHours)} SGT, so the longest normal silence is ${describeAge(activity.toleranceMs)}.`
      : `Expected: a reading within ${describeAge(target.warningAfterMs)}.`,
    `Seen: the newest reading arrived ${describeAge(ageMs)} ago.`,
  ];
  if (ageMs >= criticalAfter) return result(target, "danger", "Data: no recent data", newestReceivedAt, sourceEventAt, reasons);
  if (ageMs >= warnAfter) return result(target, "warn", "Data: delayed", newestReceivedAt, sourceEventAt, reasons);
  return result(target, "good", "Data: receiving", newestReceivedAt, sourceEventAt);
}

/**
 * A project that looks stale but whose own runs say it was told not to produce.
 *
 * Keeps the time of the last reading, so the card still says when data last
 * arrived — it is only the VERDICT that changes, from a fault to idle. The
 * service's own word is the reason, unrewritten, so it can be searched for.
 */
export function idleBecauseSkipped(health: ProjectHealth, skippedStatus: string): ProjectHealth {
  return { ...health, tone: "neutral", label: `Data: idle — ${skippedStatus}` };
}

export function healthBadge(outcome: DeliveryOutcome): { tone: HealthTone; label: string } {
  if (outcome === "provider_accepted") return { tone: "good", label: "Delivery: Provider accepted" };
  if (outcome === "device_delivered") return { tone: "good", label: "Delivery: Delivered" };
  if (outcome === "read") return { tone: "good", label: "Delivery: Read" };
  if (outcome === "transport_failed") return { tone: "danger", label: "Delivery: failed" };
  if (outcome === "provider_pending") return { tone: "warn", label: "Delivery: pending" };
  return { tone: "neutral", label: "Delivery: not monitored" };
}
