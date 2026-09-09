"use client";

import { useMemo, useState } from "react";

import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

/**
 * Running one sheet job across many projects, from a chat request.
 *
 * The chat proposes; this runs. Each project goes through `POST /api/jobs/{job}`
 * — the same endpoint the service's own action button uses, carrying the `jobs`
 * scope that `write` does not confer — so nothing here is a second way to reach
 * a service.
 *
 * **One at a time, in order.** These jobs build and fill Google Sheets against a
 * quota shared by every service on one credential, and a bootstrap over half a
 * year is not quick. Firing 23 of them at once would be the fastest way to a
 * 429 storm. Sequential also makes "stop" mean something: the run halts before
 * the next project rather than after all of them have been dispatched.
 *
 * Progress is per project and kept on screen after the run, because "which ones
 * actually finished" is the question you have at the end of a long batch — and
 * a failure part-way is normal here rather than exceptional.
 */
export type JobPlan = {
  job: string;
  label: string;
  title: string;
  serviceLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  summary: string;
  scope: string;
  runs: { projectCode: string; ready: boolean; reason: string | null }[];
};

type Outcome = { state: "pending" | "running" | "done" | "failed" | "skipped"; detail?: string };

export function JobBatch({ plan, onClose }: { plan: JobPlan; onClose: () => void }) {
  const runnable = useMemo(() => plan.runs.filter((run) => run.ready), [plan.runs]);
  const blocked = useMemo(() => plan.runs.filter((run) => !run.ready), [plan.runs]);

  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [finished, setFinished] = useState(false);
  useBodyScrollLock(true);

  const done = Object.values(outcomes).filter((o) => o.state === "done").length;
  const failed = Object.values(outcomes).filter((o) => o.state === "failed").length;

  async function run() {
    setRunning(true);
    setStopped(false);
    setFinished(false);
    // Read through a local flag as well as state: `stopped` is captured at the
    // start of this closure and would stay false for the whole loop otherwise.
    let halt = false;
    stopRef.halt = () => {
      halt = true;
    };

    for (const target of runnable) {
      if (halt) {
        setOutcomes((was) => ({ ...was, [target.projectCode]: { state: "skipped", detail: "stopped" } }));
        continue;
      }
      setOutcomes((was) => ({ ...was, [target.projectCode]: { state: "running" } }));
      try {
        const res = await fetch(`/api/jobs/${plan.job}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectCode: target.projectCode,
            startDate: plan.startDate,
            endDate: plan.endDate,
          }),
        });
        const body = await res.json().catch(() => ({}));
        setOutcomes((was) => ({
          ...was,
          [target.projectCode]: res.ok
            ? { state: "done" }
            : { state: "failed", detail: body?.error || `status ${res.status}` },
        }));
      } catch (cause) {
        setOutcomes((was) => ({
          ...was,
          [target.projectCode]: { state: "failed", detail: cause instanceof Error ? cause.message : String(cause) },
        }));
      }
    }
    setRunning(false);
    setFinished(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/85 p-3 backdrop-blur-sm md:p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl">
        <header className="border-b border-border px-4 py-3 md:px-6">
          <h2 className="text-base font-semibold text-foreground">{plan.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{plan.summary}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className="text-foreground">{plan.serviceLabel}</span> · {plan.scope} ·{" "}
            <span className="tabular-nums">
              {plan.startDate} → {plan.endDate}
            </span>{" "}
            ({plan.days} days)
          </p>
        </header>

        <div className="space-y-3 px-4 py-4 md:px-6">
          <p className="text-xs text-muted-foreground">
            {runnable.length} project{runnable.length === 1 ? "" : "s"} will run, one at a time.
            {blocked.length ? ` ${blocked.length} cannot and ${blocked.length === 1 ? "is" : "are"} listed below.` : ""}{" "}
            This writes to Google Sheets and can take a while.
          </p>

          <ul className="space-y-1">
            {plan.runs.map((target) => {
              const outcome = outcomes[target.projectCode];
              return (
                <li
                  key={target.projectCode}
                  className="flex items-baseline justify-between gap-3 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium text-foreground">{target.projectCode}</span>
                  <span className="text-right text-muted-foreground">
                    {!target.ready ? (
                      <span className="text-warn">{target.reason ?? "cannot run"}</span>
                    ) : outcome?.state === "done" ? (
                      <span className="text-primary">✓ done</span>
                    ) : outcome?.state === "failed" ? (
                      <span className="text-danger">✗ {outcome.detail}</span>
                    ) : outcome?.state === "running" ? (
                      <span className="text-foreground">running…</span>
                    ) : outcome?.state === "skipped" ? (
                      <span>stopped before this one</span>
                    ) : (
                      "queued"
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {finished ? (
            <p className="text-xs">
              <span className="text-primary">{done} finished</span>
              {failed ? <span className="text-danger">, {failed} failed</span> : null}
              {stopped ? <span className="text-muted-foreground">, stopped early</span> : null}. Re-running a job
              is safe — these are idempotent for a date range.
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            {finished ? "Close" : "Cancel"}
          </button>
          {running ? (
            <button
              type="button"
              onClick={() => {
                setStopped(true);
                stopRef.halt?.();
              }}
              className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20"
            >
              Stop after this one
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={!runnable.length || finished}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              Run {runnable.length} project{runnable.length === 1 ? "" : "s"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Lets the Stop button reach into the loop that is already running. */
const stopRef: { halt?: () => void } = {};
