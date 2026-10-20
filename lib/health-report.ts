import { troubleIn, type Bar } from "./health-timeline";
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

/** Copyable, source-worded error report from the process strips currently loaded in HALO. */
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
    }
  }
  return lines.join("\n");
}
