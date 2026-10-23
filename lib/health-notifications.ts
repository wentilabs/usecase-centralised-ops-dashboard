import { createHash } from "node:crypto";

import type { ProjectHealth } from "./data-health";
import type { Bar } from "./health-timeline";
import type { LightningNotice } from "./lightning-health";
import { SERVICES, type ServiceKey } from "./services";

export type HealthAlert = { key: string; message: string };

/** A single current finding per project and signal; history alone is not a new alert. */
export function healthAlerts(input: {
  now: Date;
  health: ProjectHealth[];
  strips: Record<string, Bar[]>;
  faults: Record<string, string>;
  notices: LightningNotice[];
}): HealthAlert[] {
  const now = input.now;
  const sgt = new Date(now.getTime() + 8 * 3_600_000);
  const hour = sgt.getUTCHours();
  if (hour < 8 || hour >= 22) return [];
  const day = sgt.toISOString().slice(0, 10);
  const staleSlot = `${day}-${Math.floor(hour / 4) * 4}`;
  const alerts: HealthAlert[] = [];
  const add = (service: ServiceKey, code: string, signal: string, severity: "red" | "amber" | "stale", details: string[], identity = "") => {
    const lines = details.map((line) => `• ${line.trim()}`).filter((line) => line !== "• ");
    if (!lines.length) return;
    // Reading ages change on every poll, so never use rendered evidence as identity.
    const fingerprint = [service, code, signal, severity, identity];
    const key = createHash("sha256").update(JSON.stringify([severity === "stale" ? staleSlot : day, fingerprint])).digest("hex");
    const symbol = severity === "red" ? "🔴" : "🟠";
    alerts.push({ key, message: `${symbol} ${code} · ${SERVICES[service].label} — ${signal}\n${lines.join("\n")}` });
  };
  for (const item of input.health) {
    const severity = item.tone === "danger" ? "red" : item.tone === "warn" ? "amber" : item.tone === "stale" ? "stale" : null;
    if (!severity) continue;
    if (severity === "stale" && hour % 4 !== 0) continue;
    add(item.service, item.projectCode, "Reading issue", severity, item.evidence?.length ? item.evidence : [item.label]);
  }
  for (const [key, bars] of Object.entries(input.strips)) {
    let parsed: unknown;
    try { parsed = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(parsed) || parsed.length !== 2) continue;
    const [service, code] = parsed as [ServiceKey, string];
    if (!(service in SERVICES) || !bars.length) continue;
    const bar = bars[bars.length - 1];
    if (bar.colour !== "red" && bar.colour !== "amber") continue;
    if (now.getTime() - new Date(bar.at).getTime() > 15 * 60_000) continue;
    for (const line of bar.log.length ? bar.log : ["No reason recorded"]) {
      add(service, code, "Process issue", bar.colour, [`${bar.kind ?? "process"} · ${bar.status}`, line], `${bar.kind ?? "process"}:${bar.status}:${line}`);
    }
  }
  for (const [key, fault] of Object.entries(input.faults)) {
    let parsed: unknown;
    try { parsed = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(parsed) || parsed.length !== 2) continue;
    const [service, code] = parsed as [ServiceKey, string];
    if (service in SERVICES && fault) add(service, code, "Configuration issue", "red", [fault]);
  }
  for (const notice of input.notices) {
    if (notice.colour !== "red" && notice.colour !== "amber") continue;
    add("lightning", notice.id === "tick" ? "Lightning tick" : "NEA feed", "Service issue", notice.colour, [notice.label]);
  }
  return alerts;
}
