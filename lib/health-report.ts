import { troubleIn, type Bar } from "./health-timeline";
import type { Incident } from "./health-board";
import { isServiceKey, SERVICES, type ServiceKey } from "./services";

export type HealthErrorProject = {
  service: ServiceKey;
  projectCode: string;
  bars: Bar[];
};

/** The same red/amber process rows shown on the board and in the copied report. */
export function healthErrorProjects(strips: Record<string, Bar[]>): HealthErrorProject[] {
  const projects: HealthErrorProject[] = [];

  for (const [key, bars] of Object.entries(strips)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length !== 2) continue;
    const service = String(parsed[0]);
    if (!isServiceKey(service)) continue;
    const projectCode = String(parsed[1]);
    const errors = troubleIn(bars)
      .filter((bar) => bar.colour === "red" || bar.colour === "amber")
      .sort((a, b) => b.at.localeCompare(a.at));
    if (errors.length) projects.push({ service, projectCode, bars: errors });
  }

  return projects.sort((a, b) => SERVICES[a.service].label.localeCompare(SERVICES[b.service].label)
    || a.projectCode.localeCompare(b.projectCode));
}

/** Current board findings not already represented by an identical process row. */
export function standaloneHealthIncidents(incidents: readonly Incident[], projects: readonly HealthErrorProject[]): Incident[] {
  return incidents.map((incident) => {
    if (incident.signal !== "run" && incident.signal !== "delivery") return incident;
    const projectCodes = incident.projects.filter((projectCode) => !projects.some((project) =>
      project.service === incident.service
      && project.projectCode === projectCode
      && project.bars.some((bar) => bar.status === incident.label),
    ));
    return { ...incident, projects: projectCodes };
  }).filter((incident) => incident.projects.length > 0);
}

function formatSgt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} SGT`;
}

/** Copyable, source-worded process errors currently loaded in HALO. */
export function formatHealthErrorReport(strips: Record<string, Bar[]>): string {
  const projects = healthErrorProjects(strips);
  if (!projects.length) return "HALO Data Health errors (last 48 hours)\nNo red or orange process errors are currently loaded.";

  const lines = ["HALO Data Health errors (last 48 hours)"];
  for (const project of projects) {
    lines.push("", `${SERVICES[project.service].label} · ${project.projectCode}`);
    for (const bar of project.bars) {
      lines.push(`- ${formatSgt(bar.at)} | ${bar.kind ? `${bar.kind} | ` : ""}${bar.status}`);
      for (const error of bar.log) lines.push(`  ${error}`);
      if (!bar.log.length) lines.push("  no reason recorded");
      for (const delivery of bar.deliveries ?? []) {
        lines.push(`  ${delivery.destination ?? "unknown destination"}: ${delivery.status}${delivery.queueId ? ` | queue ${delivery.queueId}` : ""}${delivery.messageId ? ` | message ${delivery.messageId}` : ""}`);
      }
      if (bar.deliveriesOmitted) lines.push(`  ${bar.deliveriesOmitted} further delivery records not shown`);
    }
  }
  return lines.join("\n");
}

/** Copy current board findings that process history does not already cover. */
export function formatHealthCurrentIssues(incidents: readonly Incident[], projects: readonly HealthErrorProject[]): string {
  const currentIssues = standaloneHealthIncidents(incidents, projects);
  if (currentIssues.length) {
    const lines = ["Current issues"];
    for (const incident of currentIssues) {
      const date = incident.from
        ? incident.to && incident.to !== incident.from
          ? `${formatSgt(incident.from)} → ${formatSgt(incident.to)}`
          : formatSgt(incident.from)
        : "current";
      lines.push("", `${SERVICES[incident.service].label} | ${incident.signal} | ${date}`, `  ${incident.label}`);
      lines.push(`  Projects: ${incident.projects.join(", ")}`);
    }
    return lines.join("\n");
  }
  return "";
}
