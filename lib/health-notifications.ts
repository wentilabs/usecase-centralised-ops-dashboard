import { createHash } from "node:crypto";

import type { ProjectHealth } from "./data-health";
import type { Bar } from "./health-timeline";
import type { LightningNotice } from "./lightning-health";
import { isServiceKey, SERVICE_KEYS, SERVICES, type ServiceKey } from "./services";

export type HealthSummary = { key: string; message: string; windowStart: Date; windowEnd: Date; issueCount: number };
export type HealthNotifyOptions = { dryRun: boolean; force: boolean };

export function parseHealthNotifyOptions(value: unknown): HealthNotifyOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => key !== "dryRun" && key !== "force");
  if (unknown.length) throw new Error(`Unknown field: ${unknown[0]}.`);
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw new Error("dryRun must be a boolean.");
  if (body.force !== undefined && typeof body.force !== "boolean") throw new Error("force must be a boolean.");
  if (body.dryRun === true && body.force === true) throw new Error("Use dryRun or force, not both.");
  return { dryRun: body.dryRun === true, force: body.force === true };
}

export function healthSummaryKey(windowEnd: Date): string {
  return createHash("sha256").update(`halo-health-summary:${windowEnd.toISOString()}`).digest("hex");
}

/** The relay runs every five minutes; only the first fifteen minutes of a slot may send its digest. */
export function dueHealthWindow(now: Date): { start: Date; end: Date } | null {
  const sgt = new Date(now.getTime() + 8 * 3_600_000);
  if (sgt.getUTCMinutes() >= 15 || sgt.getUTCHours() % 8 !== 0) return null;
  const end = new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate(), sgt.getUTCHours()) - 8 * 3_600_000);
  return { start: new Date(end.getTime() - 8 * 3_600_000), end };
}

/** Manual inspection and forced delivery use the eight hours immediately before invocation. */
export function currentHealthWindow(now: Date): { start: Date; end: Date } {
  return { start: new Date(now.getTime() - 8 * 3_600_000), end: now };
}

type Issue = { service: ServiceKey; code: string; severity: "red" | "amber"; kind: string; error: string };

function projectKey(key: string): [ServiceKey, string] | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !isServiceKey(value[0])) return null;
    return [value[0], String(value[1]).trim()];
  } catch {
    return null;
  }
}

function stamp(value: Date): string {
  return new Date(value.getTime() + 8 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** One message for every service, using historical processes and current standing findings. */
export function healthSummary(input: {
  windowStart: Date;
  windowEnd: Date;
  health: ProjectHealth[];
  strips: Record<string, Bar[]>;
  faults: Record<string, string>;
  notices: LightningNotice[];
}): HealthSummary {
  const issues: Issue[] = [];
  const add = (service: ServiceKey, code: string, severity: "red" | "amber", kind: string, error: string) => {
    if (error.trim()) issues.push({ service, code, severity, kind, error: error.trim().replace(/\s+/g, " ") });
  };

  for (const [key, bars] of Object.entries(input.strips)) {
    const project = projectKey(key);
    if (!project) continue;
    const [service, code] = project;
    for (const bar of bars) {
      const at = new Date(bar.at).getTime();
      if (!Number.isFinite(at) || at < input.windowStart.getTime() || at >= input.windowEnd.getTime()) continue;
      if (bar.colour !== "red" && bar.colour !== "amber") continue;
      const kind = [bar.kind, bar.status].filter(Boolean).join(" · ");
      for (const error of bar.log.length ? bar.log : ["No reason recorded"]) add(service, code, bar.colour, kind, error);
    }
  }
  for (const item of input.health) {
    if (item.tone !== "danger" && item.tone !== "warn") continue;
    add(item.service, item.projectCode, item.tone === "danger" ? "red" : "amber", "Current reading issue", item.label);
  }
  for (const [key, error] of Object.entries(input.faults)) {
    const project = projectKey(key);
    if (project) add(project[0], project[1], "red", "Current configuration issue", error);
  }
  for (const notice of input.notices) {
    if (notice.colour === "red" || notice.colour === "amber") {
      add("lightning", notice.id === "tick" ? "Lightning tick" : "NEA feed", notice.colour, "Current service issue", notice.label);
    }
  }

  // The same service, severity, process and error forms one line across repeated runs and projects.
  const grouped = new Map<string, { issue: Issue; codes: Set<string>; occurrences: number }>();
  for (const issue of issues) {
    const key = JSON.stringify([issue.service, issue.severity, issue.kind, issue.error]);
    const group = grouped.get(key) ?? { issue, codes: new Set<string>(), occurrences: 0 };
    group.codes.add(issue.code);
    group.occurrences++;
    grouped.set(key, group);
  }

  const lines = [`HALO Data Health · ${stamp(input.windowStart)}–${stamp(input.windowEnd)} SGT`];
  if (!grouped.size) lines.push("✅ No red or orange issues reported.");
  for (const service of SERVICE_KEYS) {
    lines.push("", `*${SERVICES[service].label}*`);
    const groups = [...grouped.values()]
      .filter((group) => group.issue.service === service)
      .sort((a, b) => Number(a.issue.severity === "amber") - Number(b.issue.severity === "amber")
        || a.issue.kind.localeCompare(b.issue.kind) || a.issue.error.localeCompare(b.issue.error));
    if (!groups.length) {
      lines.push("✅ No red or orange issues reported");
      continue;
    }
    for (const group of groups) {
      const { issue, codes, occurrences } = group;
      const symbol = issue.severity === "red" ? "🔴" : "🟠";
      const count = occurrences > 1 ? ` (×${occurrences})` : "";
      lines.push(`${symbol} ${[...codes].sort().join(", ")} — ${issue.kind}: ${issue.error}${count}`);
    }
  }
  const key = healthSummaryKey(input.windowEnd);
  return { key, message: lines.join("\n"), windowStart: input.windowStart, windowEnd: input.windowEnd, issueCount: grouped.size };
}
