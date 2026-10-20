"use client";

import { useState } from "react";

import { LoadStamps } from "./LoadStamps";
import { RefreshHealthButton } from "./RefreshHealthButton";
import type { Load } from "@/lib/load-stamps";

import { SERVICES, type ServiceKey } from "@/lib/services";
import type { BoardSummary, Incident } from "@/lib/health-board";
import { formatHealthCurrentIssues, formatHealthErrorReport, healthErrorProjects, standaloneHealthIncidents } from "@/lib/health-report";
import type { Bar } from "@/lib/health-timeline";

/** `2026-10-16T10:00:12+00:00` → `10-16 10:00`, and a range when it spans time. */
function when(incident: Incident): string | null {
  const short = (iso: string) => iso.slice(5, 16).replace("T", " ");
  if (!incident.from) return null;
  if (!incident.to || incident.to.slice(0, 16) === incident.from.slice(0, 16)) return short(incident.from);
  return `${short(incident.from)} → ${short(incident.to)}`;
}

function processTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * What is wrong right now, named — not how many things are fine.
 *
 * This board used to show three counts per service: "24 receiving · 1 delayed ·
 * 0 needs attention". That is the wrong way round for triage. The counts are
 * reassuring and unactionable; the one thing a reader came for — WHICH project,
 * and what did it say — was the part left out.
 *
 * So the exceptions are the content and the healthy majority is a footnote, and
 * they are grouped: one failure that hit thirty projects is ONE row naming
 * thirty projects, not thirty rows saying the same word at the same minute. The
 * first live run of the delivery reader produced exactly that — Haze's listener
 * stopped confirming recipients and every project in the estate reported
 * UNCONFIRMED — which reads as thirty problems and is one.
 *
 * A row carries the service's own status text rather than a rewording of it,
 * because the next thing the reader does is search logs for that exact string.
 */
export function DataHealthBoard({ summary, strips, onClose, onOpenProject, onRefresh, loads, refreshing = false, refreshedAt = null, refreshFailed = false }: {
  summary: BoardSummary;
  strips: Record<string, Bar[]>;
  /** Forget what is remembered and read it all again: the board is where someone checks that a fix cleared. */
  onRefresh?: () => void;
  /** What has loaded, when, and how long it took: the board is where someone decides whether to trust what they see. */
  loads?: { label: string; load: Load; hint: string }[];
  refreshing?: boolean;
  refreshedAt?: string | null;
  refreshFailed?: boolean;
  onClose: () => void;
  /** Jump to that project's editor — the row is the start of a fix, not a report. */
  onOpenProject?: (service: ServiceKey, projectCode: string) => void;
}) {
  const errorProjects = healthErrorProjects(strips);
  const currentIssues = standaloneHealthIncidents(summary.incidents, errorProjects);
  const errorProcessCount = errorProjects.reduce((total, project) => total + project.bars.length, 0);
  const errorProjectCount = errorProjects.length;
  const errorsByService = new Map<ServiceKey, typeof errorProjects>();
  for (const project of errorProjects) {
    const projects = errorsByService.get(project.service) ?? [];
    projects.push(project);
    errorsByService.set(project.service, projects);
  }
  const issuesByService = new Map<ServiceKey, typeof currentIssues>();
  for (const issue of currentIssues) {
    const issues = issuesByService.get(issue.service) ?? [];
    issues.push(issue);
    issuesByService.set(issue.service, issues);
  }
  const servicesWithIssues = [...new Set([...errorsByService.keys(), ...issuesByService.keys()])]
    .sort((a, b) => SERVICES[a].label.localeCompare(SERVICES[b].label));
  const [copyStatus, setCopyStatus] = useState("");
  const copyErrors = async () => {
    try {
      const processReport = formatHealthErrorReport(strips);
      const issueReport = formatHealthCurrentIssues(summary.incidents, errorProjects);
      const hasProcessErrors = errorProcessCount > 0;
      const report = issueReport
        ? hasProcessErrors ? `${processReport}\n\n${issueReport}` : `HALO Data Health report\n\n${issueReport}`
        : processReport;
      await navigator.clipboard.writeText(report);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy unavailable");
    }
    window.setTimeout(() => setCopyStatus(""), 2200);
  };

  return (
    <div className="pt-safe-dialog fixed inset-0 z-50 bg-black/65 p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Data Health">
      <section className="mx-auto flex max-h-full max-w-6xl flex-col rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold">Data Health</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {errorProcessCount || currentIssues.length
                ? [
                    errorProcessCount ? `${errorProcessCount} process error${errorProcessCount === 1 ? "" : "s"} across ${errorProjectCount} project${errorProjectCount === 1 ? "" : "s"}` : null,
                    currentIssues.length ? `${currentIssues.length} current issue${currentIssues.length === 1 ? "" : "s"}` : null,
                  ].filter(Boolean).join(" · ") + "."
                : "Nothing needs attention."}{" "}
              {/* Said once, here, rather than on every card: there is nothing to
                  switch on, so a reader seeing a quiet board knows the check ran
                  rather than wondering whether it was ever configured. */}
              <span className="opacity-70">Every covered project is automatically monitored.</span>
            </p>
            {loads ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                <LoadStamps loads={loads} />
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap items-start justify-end gap-2">
            {onRefresh ? (
              <RefreshHealthButton onRefresh={onRefresh} refreshing={refreshing} refreshedAt={refreshedAt} failed={refreshFailed} />
            ) : null}
            <button
              type="button"
              onClick={() => void copyErrors()}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
              aria-label="Copy all red and orange Data Health process errors and current issues"
            >
              {copyStatus || "Copy errors"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
            >
              Close
            </button>
          </div>
        </header>

        {/* Each service keeps its own reading space so process history and current findings share the grid. */}
        <div className="flex flex-col gap-7 overflow-y-auto px-5 pb-7 pt-5">
          {servicesWithIssues.length ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Issues by service</h3>
              <p className="mb-3 text-[11px] text-muted-foreground">Process errors from the last 48 hours and current health findings.</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {servicesWithIssues.map((service) => {
                  const projects = errorsByService.get(service) ?? [];
                  const incidents = issuesByService.get(service) ?? [];
                  const serviceProcessCount = projects.reduce((total, project) => total + project.bars.length, 0);
                  return (
                  <section key={service} className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card">
                    <header className="flex items-baseline justify-between gap-3 border-b border-border px-3.5 py-3">
                      <h4 className="text-sm font-semibold">{SERVICES[service].label}</h4>
                      <span className="text-right text-[11px] text-muted-foreground">
                        {serviceProcessCount ? `${serviceProcessCount} process error${serviceProcessCount === 1 ? "" : "s"}` : null}
                        {serviceProcessCount && incidents.length ? " · " : null}
                        {incidents.length ? `${incidents.length} current issue${incidents.length === 1 ? "" : "s"}` : null}
                      </span>
                    </header>
                    <div className="max-h-[min(30rem,60vh)] min-h-0 flex-1 overflow-auto overscroll-contain">
                      {incidents.length ? (
                        <ul className="divide-y divide-border">
                          {incidents.map((incident) => {
                            const red = incident.colour === "red";
                            return (
                              <li key={`${incident.service}|${incident.signal}|${incident.label}`} className={`px-3.5 py-3 ${red ? "bg-danger/5" : "bg-warn/5"}`}>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                  <span className={`text-xs font-semibold ${red ? "text-danger" : "text-warn"}`}>●</span>
                                  <span className="rounded border border-border px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{incident.signal}</span>
                                  <span className="min-w-0 break-words font-mono text-[11px] font-medium">{incident.label}</span>
                                  {when(incident) ? <span className="ml-auto text-[10px] text-muted-foreground">{when(incident)}</span> : null}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {incident.projects.map((projectCode) => incident.scope === "service" ? (
                                    <span key={projectCode} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">{projectCode}</span>
                                  ) : (
                                    <button key={projectCode} type="button" onClick={() => onOpenProject?.(incident.service, projectCode)} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] hover:border-primary">{projectCode}</button>
                                  ))}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {projects.length ? <table className="w-full table-fixed text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-card text-[10px] uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="w-[27%] px-3.5 py-2.5 font-medium">Project / process</th>
                            <th className="w-[47%] px-3.5 py-2.5 font-medium">Error</th>
                            <th className="w-[26%] px-3.5 py-2.5 font-medium">Last run</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {projects.flatMap((project) => project.bars.map((bar, index) => {
                            const red = bar.colour === "red";
                            return (
                              <tr key={`${project.service}|${project.projectCode}|${bar.at}|${bar.kind ?? ""}|${index}`} className="align-top">
                                <td className="break-words px-3.5 py-3">
                                  <button
                                    type="button"
                                    onClick={() => onOpenProject?.(project.service, project.projectCode)}
                                    className="font-mono font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-primary"
                                  >
                                    {project.projectCode}
                                  </button>
                                  {bar.kind ? <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{bar.kind}</div> : null}
                                </td>
                                <td className="break-words px-3.5 py-3">
                                  <div className={`font-medium ${red ? "text-danger" : "text-warn"}`}>{bar.status}</div>
                                  {bar.log.length ? (
                                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                                      {bar.log.map((line, lineIndex) => <li key={`${lineIndex}|${line}`}>{line}</li>)}
                                    </ul>
                                  ) : <div className="mt-1 text-[11px] text-muted-foreground">No reason recorded</div>}
                                </td>
                                {/* Date over time, not one nowrap line: "20 Oct, 18:05 SGT" overflowed its
                                    column and was cut off at "20 Oct, 18". */}
                                <td className="px-3.5 py-3 font-mono text-[10px] leading-snug text-muted-foreground">
                                  {(() => {
                                    const [day, clock] = processTime(bar.at).split(", ");
                                    return (
                                      <>
                                        <div>{day}</div>
                                        <div>{clock ? `${clock} SGT` : "SGT"}</div>
                                      </>
                                    );
                                  })()}
                                </td>
                              </tr>
                            );
                          }))}
                        </tbody>
                      </table> : null}
                    </div>
                  </section>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!errorProcessCount && !currentIssues.length ? (
            <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              {summary.green} project{summary.green === 1 ? "" : "s"} reporting, {summary.idle} idle outside their
              cadence hours.
            </p>
          ) : null}

          {/* Late readings: the sensor or its feed, with the service working. A
              calm section of their own, after everything that needs acting on and
              in their own colour, so they are findable without being a to-do. */}
          {summary.late.length ? (
            <div className="border-t border-border pt-4">
              <h3 className="text-[12px] font-medium text-stale-text">
                Late readings — {summary.stale} project{summary.stale === 1 ? "" : "s"}
              </h3>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                The service ran fine; the sensor or its feed is behind. Not counted as needing action.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {summary.late.map((incident) => (
                  <li
                    key={`${incident.service}|${incident.signal}|${incident.label}`}
                    className="rounded-lg border border-stale/50 bg-stale/10 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="text-sm font-semibold text-stale-text">●</span>
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {SERVICES[incident.service].label}
                      </span>
                      <span className="font-mono text-[12px] font-medium">{incident.label}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {incident.projects.length} project{incident.projects.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {incident.projects.map((projectCode) =>
                        incident.scope === "service" ? (
                          // A whole-service finding (the tick, the feed) is not a project: there is no editor to open.
                          <span key={projectCode} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]">
                            {projectCode}
                          </span>
                        ) : (
                          <button
                            key={projectCode}
                            type="button"
                            onClick={() => onOpenProject?.(incident.service, projectCode)}
                            className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary"
                          >
                            {projectCode}
                          </button>
                        ),
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Coverage is stated, not implied. A service recording no evidence is
              not a healthy service, and leaving it out of the list entirely
              would read as a clean bill of health. */}
          {summary.uncovered.length ? (
            <p className="border-t border-border pt-4 text-[12px] leading-snug text-muted-foreground">
              <span className="font-medium">Not covered:</span>{" "}
              {summary.uncovered.map((service) => SERVICES[service].label).join(", ")} — each declares what it would
              report, but nothing reads it yet, so HALO cannot say whether they are healthy. See{" "}
              <span className="font-mono">docs/DATA_HEALTH.md</span>.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
