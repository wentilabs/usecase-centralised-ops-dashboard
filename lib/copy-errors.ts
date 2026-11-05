import { SERVICES, SERVICE_KEYS } from "./services";
import { formatHealthCurrentIssues, formatHealthErrorReport, healthErrorProjects } from "./health-report";
import { groupHandlerFailures, type HandlerFailureReport } from "./handler-failures";
import type { BoardSummary } from "./health-board";
import type { Bar } from "./health-timeline";

export function formatCopyErrorsReport(input: {
  summary: BoardSummary;
  strips: Record<string, Bar[]>;
  handlerReport: HandlerFailureReport | null;
  handlerReadState: "loading" | "ready" | "unavailable";
}): string {
  const { summary, strips, handlerReport, handlerReadState } = input;
  const errorProjects = healthErrorProjects(strips);
  const errorProcessCount = errorProjects.reduce((total, project) => total + project.bars.length, 0);
  const processReport = formatHealthErrorReport(strips);
  const issueReport = formatHealthCurrentIssues(summary.incidents, errorProjects);
  const report = issueReport
    ? errorProcessCount ? `${processReport}\n\n${issueReport}` : `HALO Data Health report\n\n${issueReport}`
    : processReport;
  const processTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date);
  };
  const handlerGroups = groupHandlerFailures(handlerReport?.failures ?? []);
  const handlerLines = handlerGroups.map((group) =>
    `${SERVICES[group.service].label} | ${processTime(group.firstAt)}–${processTime(group.lastAt)} SGT | ${group.route ?? "route unknown"} | ${group.eventType} | ${group.occurrences} record${group.occurrences === 1 ? "" : "s"}${group.projects.length ? ` | Projects: ${group.projects.join(", ")}` : ""}${group.unscoped ? " | Includes unscoped records" : ""} | ${group.reason}`,
  );
  const incomplete = handlerReport?.sources.filter((source) => source.state === "unavailable" || source.state === "partial") ?? [];
  const coverageLine = handlerReadState !== "ready"
    ? `\nAnomaly evidence ${handlerReadState === "loading" ? "still loading" : "unavailable"}; absence of records is not evidence of health.`
    : incomplete.length ? `\nIncomplete anomaly evidence: ${incomplete.map((source) => SERVICES[source.service].label).join(", ")}` : "";
  const checkedAt = handlerReport?.checkedAt;
  const validCheckedAt = checkedAt && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : null;
  const metadata = [
    `Anomaly checkedAt: ${validCheckedAt ?? "unavailable"}`,
    validCheckedAt
      ? `Anomaly query window: ${new Date(Date.parse(validCheckedAt) - 48 * 60 * 60_000).toISOString()} <= timestamp <= ${validCheckedAt} (48 hours; UTC)`
      : "Anomaly query window: unavailable",
    "Scope: process history uses separately collected rolling 48-hour reads and per-project limits; current issues may predate that window.",
    "Anomaly source coverage:",
    ...SERVICE_KEYS.map((service) => {
      const state = handlerReadState === "ready"
        ? handlerReport?.sources.find((source) => source.service === service)?.state ?? "unavailable"
        : handlerReadState;
      return `- ${SERVICES[service].label}: ${state}`;
    }),
    "Coverage describes recorded evidence reads, not service health. Legacy coverage is limited to older handler records; partial coverage may omit records. Absence of findings does not establish health.",
  ].join("\n");
  const findings = handlerLines.length || coverageLine ? `${report}\n\nRecent service anomalies\n${handlerLines.join("\n")}${coverageLine}` : report;
  return `${metadata}\n\n${findings}`;
}
