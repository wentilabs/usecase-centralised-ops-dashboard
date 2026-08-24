"use client";

import { useMemo, useState } from "react";

import { jobTargets, spanDays, validateJobInput, type JobDefinition } from "@/lib/jobs";
import type { ProjectConfigRow } from "@/lib/services";
import { useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * Collects the three inputs a sheet job needs and posts it.
 *
 * Dates use `<input type="date">` on purpose: it gives a real calendar picker on
 * both desktop and phone without shipping a date library, and it hands back
 * exactly the YYYY-MM-DD the endpoints expect.
 *
 * A project whose precondition is unmet (no sheet id, or no upstream to scrape)
 * is listed but not runnable — the button stays disabled and says why, since the
 * job would otherwise report success while doing nothing.
 */
export function JobDialog({
  job,
  rows,
  onClose,
}: {
  job: JobDefinition;
  rows: ProjectConfigRow[];
  onClose: () => void;
}) {
  const targets = useMemo(() => jobTargets(job, rows), [job, rows]);

  const [projectCode, setProjectCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  useEscapeKey(!busy, onClose);

  const selected = targets.find((target) => target.projectCode === projectCode);
  const problems = validateJobInput(
    { projectCode, startDate, endDate },
    { job, ready: selected?.ready, reason: selected?.reason },
  );
  const canRun = problems.length === 0;

  // The precondition gets its own line under the picker, so repeating it in the
  // problems list below said the same sentence twice.
  const preconditionMessage = projectCode
    ? (selected?.reason ?? job.precondition.unmet(projectCode))
    : null;
  const listedProblems = problems.filter((problem) => problem !== preconditionMessage);

  const span =
    startDate && endDate && startDate <= endDate ? spanDays(startDate, endDate) : null;

  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/jobs/${job.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCode, startDate, endDate, flags }),
      });
      const body = await res.json();
      if (!res.ok) {
        setOutcome({ ok: false, text: body.error ?? `HTTP ${res.status}` });
        return;
      }
      const summary = typeof body.result === "string" ? body.result : JSON.stringify(body.result, null, 1);
      setOutcome({ ok: true, text: summary.slice(0, 1500) });
    } catch (error) {
      setOutcome({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-background p-4 shadow-2xl md:max-h-[85vh] md:w-[min(520px,92vw)] md:rounded-2xl md:p-5">
        <h3 className="text-base font-semibold">{job.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{job.description}</p>

        <label className="mt-4 block text-xs text-muted-foreground" htmlFor="job-project">
          Project
        </label>
        <select
          id="job-project"
          className={field}
          value={projectCode}
          disabled={busy}
          onChange={(event) => {
            setProjectCode(event.target.value);
            setOutcome(null);
          }}
        >
          <option value="">— choose a project —</option>
          {targets.map((target) => (
            <option key={target.projectCode} value={target.projectCode}>
              {target.projectCode}
              {target.ready ? "" : `  (${job.precondition.label.toLowerCase()} unavailable)`}
            </option>
          ))}
        </select>

        {projectCode ? (
          <p className={`mt-1.5 text-[11px] ${selected?.ready ? "text-muted-foreground" : "text-warn"}`}>
            {selected?.ready ? `${job.precondition.label}: ${selected.ready}` : preconditionMessage}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-muted-foreground" htmlFor="job-start">
              Start date
            </label>
            <input
              id="job-start"
              type="date"
              className={field}
              value={startDate}
              max={endDate || undefined}
              disabled={busy}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground" htmlFor="job-end">
              End date
            </label>
            <input
              id="job-end"
              type="date"
              className={field}
              value={endDate}
              min={startDate || undefined}
              disabled={busy}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>

        {span !== null ? (
          <p
            className={`mt-2 text-[11px] ${
              job.maxSpanDays && span > job.maxSpanDays ? "text-danger" : "text-muted-foreground"
            }`}
          >
            {span} day{span === 1 ? "" : "s"} inclusive
            {job.maxSpanDays ? ` · this job accepts at most ${job.maxSpanDays}` : ""}
          </p>
        ) : null}

        {job.flags?.length ? (
          <div className="mt-3 flex flex-col gap-2">
            {job.flags.map((flag) => (
              <label key={flag.key} className="flex min-h-11 items-start gap-2 text-sm md:min-h-0">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={flags[flag.key] === true}
                  disabled={busy}
                  onChange={(event) => setFlags((prev) => ({ ...prev, [flag.key]: event.target.checked }))}
                />
                <span>
                  <span className="font-mono text-xs">{flag.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{flag.help}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {job.caution ? (
          <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] text-warn">
            {job.caution}
          </p>
        ) : null}

        {listedProblems.length && (projectCode || startDate || endDate) ? (
          <ul className="mt-3 list-inside list-disc text-[11px] text-warn">
            {listedProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}

        {outcome ? (
          <div
            className={`mt-3 rounded-lg border p-3 ${
              outcome.ok ? "border-on/40 bg-on/10" : "border-danger/40 bg-danger/10"
            }`}
          >
            <div className={`text-xs font-semibold ${outcome.ok ? "text-on" : "text-danger"}`}>
              {outcome.ok ? "Job accepted" : "Job failed"}
            </div>
            <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
              {outcome.text}
            </pre>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2 pb-safe">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2.5 text-sm disabled:opacity-50 md:py-1.5"
          >
            {outcome?.ok ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canRun || busy}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 md:py-1.5"
          >
            {busy ? "Running…" : job.label.replace(/^[^\s]+\s/, "")}
          </button>
        </div>
      </div>
    </div>
  );
}
