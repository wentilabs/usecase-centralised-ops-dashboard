"use client";

import { useMemo, useState } from "react";

import { jobTargets, validateJobInput, type JobDefinition } from "@/lib/jobs";
import type { ProjectConfigRow } from "@/lib/services";
import { useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * Collects the three inputs a sheet job needs and posts it.
 *
 * Dates use `<input type="date">` on purpose: it gives a real calendar picker on
 * both desktop and phone without shipping a date library, and it hands back
 * exactly the YYYY-MM-DD the endpoints expect.
 *
 * A project whose sheet id is missing is listed but not selectable-through —
 * the button stays disabled and says why, since the job would otherwise report
 * success while writing nothing.
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
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  useEscapeKey(!busy, onClose);

  const selected = targets.find((target) => target.projectCode === projectCode);
  const problems = validateJobInput({ projectCode, startDate, endDate }, { sheetId: selected?.sheetId });
  const ready = problems.length === 0;

  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/jobs/${job.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCode, startDate, endDate }),
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
              {target.sheetId ? "" : "  (no sheet id)"}
            </option>
          ))}
        </select>

        {projectCode ? (
          <p className={`mt-1.5 text-[11px] ${selected?.sheetId ? "text-muted-foreground" : "text-warn"}`}>
            {selected?.sheetId
              ? `${job.sheetLabel}: ${selected.sheetId.slice(0, 12)}…`
              : `${job.sheetLabel} is not configured on ${projectCode}. Set it in the project's editor first — the job would write nothing.`}
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

        {problems.length && (projectCode || startDate || endDate) ? (
          <ul className="mt-3 list-inside list-disc text-[11px] text-warn">
            {problems.map((problem) => (
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
            disabled={!ready || busy}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 md:py-1.5"
          >
            {busy ? "Running…" : job.label.replace(/^[^\s]+\s/, "")}
          </button>
        </div>
      </div>
    </div>
  );
}
