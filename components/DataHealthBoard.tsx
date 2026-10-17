"use client";

import { SERVICES, type ServiceKey } from "@/lib/services";
import type { BoardSummary, Incident } from "@/lib/health-board";

/** `2026-10-16T10:00:12+00:00` → `10-16 10:00`, and a range when it spans time. */
function when(incident: Incident): string | null {
  const short = (iso: string) => iso.slice(5, 16).replace("T", " ");
  if (!incident.from) return null;
  if (!incident.to || incident.to.slice(0, 16) === incident.from.slice(0, 16)) return short(incident.from);
  return `${short(incident.from)} → ${short(incident.to)}`;
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
export function DataHealthBoard({ summary, onClose, onOpenProject }: {
  summary: BoardSummary;
  onClose: () => void;
  /** Jump to that project's editor — the row is the start of a fix, not a report. */
  onOpenProject?: (service: ServiceKey, projectCode: string) => void;
}) {
  const affected = summary.red + summary.amber;

  return (
    <div className="pt-safe-dialog fixed inset-0 z-50 bg-black/65 p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Data Health">
      <section className="mx-auto flex max-h-full max-w-3xl flex-col rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold">Data Health</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.incidents.length
                ? `${summary.incidents.length} issue${summary.incidents.length === 1 ? "" : "s"} across ${affected} project${affected === 1 ? "" : "s"}.`
                : "Nothing needs attention."}{" "}
              {/* Said once, here, rather than on every card: there is nothing to
                  switch on, so a reader seeing a quiet board knows the check ran
                  rather than wondering whether it was ever configured. */}
              <span className="opacity-70">Every covered project is automatically monitored.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
          >
            Close
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          {summary.incidents.length ? (
            <ul className="flex flex-col gap-2">
              {summary.incidents.map((incident) => {
                const red = incident.colour === "red";
                const stamp = when(incident);
                return (
                  <li
                    key={`${incident.service}|${incident.signal}|${incident.label}`}
                    className={`rounded-lg border px-3 py-2.5 ${red ? "border-danger/40 bg-danger/5" : "border-warn/40 bg-warn/5"}`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className={`text-sm font-semibold ${red ? "text-danger" : "text-warn"}`}>●</span>
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {SERVICES[incident.service].label}
                      </span>
                      {/* Which question failed. A project can be receiving data
                          and failing to send it, and those are two different
                          people's problems. */}
                      <span className="rounded border border-border px-1 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {incident.signal}
                      </span>
                      {/* The service's own words, unrewritten — this is the
                          string a reader will grep the logs for. */}
                      <span className="font-mono text-[12px] font-medium">{incident.label}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {incident.projects.length} project{incident.projects.length === 1 ? "" : "s"}
                      </span>
                      {stamp ? <span className="ml-auto font-mono text-[11px] text-muted-foreground">{stamp}</span> : null}
                    </div>

                    {/* The codes stay visible rather than hidden behind a
                        disclosure: "thirty projects" is the shape of the
                        problem, but WHICH thirty is what tells a reader whether
                        it is the whole estate or one client. */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {incident.projects.map((projectCode) => (
                        <button
                          key={projectCode}
                          type="button"
                          onClick={() => onOpenProject?.(incident.service, projectCode)}
                          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary"
                        >
                          {projectCode}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              {summary.green} project{summary.green === 1 ? "" : "s"} reporting, {summary.idle} idle outside their
              cadence hours.
            </p>
          )}

          {/* Coverage is stated, not implied. A service recording no evidence is
              not a healthy service, and leaving it out of the list entirely
              would read as a clean bill of health. */}
          {summary.uncovered.length ? (
            <p className="mt-4 border-t border-border pt-3 text-[12px] leading-snug text-muted-foreground">
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
