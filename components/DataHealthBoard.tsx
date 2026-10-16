"use client";

import { SERVICES, type ServiceKey } from "@/lib/services";
import type { BoardSummary } from "@/lib/health-board";

/**
 * What is wrong right now, named — not how many things are fine.
 *
 * This board used to show three counts per service: "24 receiving · 1 delayed ·
 * 0 needs attention". That is the wrong way round for triage. The counts are
 * reassuring and unactionable; the one thing a reader came for — WHICH project,
 * and what did it say — was the part left out.
 *
 * So the exceptions are the content and the healthy majority is a footnote. A
 * row carries the service's own status text rather than a rewording of it,
 * because the next thing the reader does is search logs for that exact string.
 */
export function DataHealthBoard({ summary, onClose, onOpenProject }: {
  summary: BoardSummary;
  onClose: () => void;
  /** Jump to that project's editor — the row is the start of a fix, not a report. */
  onOpenProject?: (service: ServiceKey, projectCode: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/65 p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Data Health">
      <section className="mx-auto flex max-h-full max-w-3xl flex-col rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold">Data Health</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.exceptions.length
                ? `${summary.exceptions.length} project${summary.exceptions.length === 1 ? " needs" : "s need"} attention.`
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
          {summary.exceptions.length ? (
            <ul className="flex flex-col gap-1.5">
              {summary.exceptions.map((entry) => (
                <li key={`${entry.service}:${entry.projectCode}`}>
                  <button
                    type="button"
                    onClick={() => onOpenProject?.(entry.service, entry.projectCode)}
                    className={`flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2 text-left transition-colors hover:border-primary ${
                      entry.colour === "red" ? "border-danger/40 bg-danger/5" : "border-warn/40 bg-warn/5"
                    }`}
                  >
                    <span className={`text-sm font-semibold ${entry.colour === "red" ? "text-danger" : "text-warn"}`}>
                      ●
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {SERVICES[entry.service].label}
                    </span>
                    <span className="font-mono text-sm font-medium">{entry.projectCode}</span>
                    {/* The service's own words, unrewritten — this is the string
                        a reader will grep the logs for. */}
                    <span className="font-mono text-[12px] text-muted-foreground">{entry.label}</span>
                    {entry.detail ? (
                      <span className="ml-auto text-[11px] text-muted-foreground">{entry.detail.slice(0, 16).replace("T", " ")}</span>
                    ) : null}
                  </button>
                </li>
              ))}
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
