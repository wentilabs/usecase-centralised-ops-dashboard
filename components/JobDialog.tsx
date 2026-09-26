"use client";

import { useMemo, useState } from "react";

import { useBackdropDismiss } from "@/lib/backdrop-dismiss";
import { defaultChoice, eachChunk, jobTargets, spanDays, validateJobInput, type JobDefinition } from "@/lib/jobs";
import { previewMessages, readJson, summariseJobResult, type PreviewMessage } from "@/lib/read-json";
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
  groupNames,
  onClose,
}: {
  job: JobDefinition;
  rows: ProjectConfigRow[];
  /** chat id → group name, so a preview names its destinations. */
  groupNames?: Record<string, string>;
  onClose: () => void;
}) {

  const targets = useMemo(() => jobTargets(job, rows), [job, rows]);

  const [projectCode, setProjectCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  // Always a real option, never blank: a job with a choice has a primary one,
  // and an empty select would be a state the endpoint cannot be called in.
  const [choice, setChoice] = useState<string | undefined>(() => defaultChoice(job));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * What came back, when a line of counts is not the answer.
   *
   * A preview's output is the message text and a diagnostic's is its fields —
   * see `resultView`. Kept beside `outcome` rather than inside it because the
   * headline and the body are written by different code paths.
   */
  const [detail, setDetail] = useState<
    { messages: PreviewMessage[] } | { json: string } | null
  >(null);
  /** Which chunk is in flight, so a twenty-minute run is not a frozen button. */
  const [progress, setProgress] = useState<string | null>(null);

  useEscapeKey(!busy, onClose);
  // Click the backdrop to close, on the same guard as Escape.
  const dismiss = useBackdropDismiss(!busy, onClose);

  const selected = targets.find((target) => target.projectCode === projectCode);
  const problems = validateJobInput(
    { projectCode, startDate, endDate, choice },
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

  /** Whether this run will act, for a job that previews unless told otherwise. */
  const applies = Boolean(job.appliesWhen && flags[job.appliesWhen] === true);

  async function run() {
    setBusy(true);
    setOutcome(null);
    setDetail(null);
    try {
      /**
       * A `perDay` endpoint takes one date, so the range is walked here rather
       * than in the route.
       *
       * It was looped server-side first, and that request outlived the
       * platform's function timeout: it was killed around the tenth day and the
       * browser got an empty body, which surfaced as "Unexpected end of JSON
       * input" — a parser message that says nothing about what happened. One
       * request per date is short enough that no timeout is in play at all.
       */
      // A dateless job has nothing to walk: one request, no range in the body.
      const chunks = job.dateless ? [null] : eachChunk(startDate, endDate, job.chunkDays);
      const results: string[] = [];

      for (const [index, chunk] of chunks.entries()) {
        const label = chunk
          ? chunk.startDate === chunk.endDate
            ? chunk.startDate
            : `${chunk.startDate}–${chunk.endDate}`
          : "";
        setProgress(chunks.length > 1 ? `${label} — ${index + 1} of ${chunks.length}` : null);
        const res = await fetch(`/api/jobs/${job.key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectCode,
            ...(chunk ? { startDate: chunk.startDate, endDate: chunk.endDate } : {}),
            ...(choice ? { choice } : {}),
            flags,
          }),
        });
        const body = await readJson(res);
        if (!res.ok) {
          setOutcome({
            ok: false,
            text:
              `${body?.error ?? `HTTP ${res.status}`}${chunks.length > 1 ? ` (on ${label})` : ""}` +
              (chunk && index > 0
                ? `\n\n${index} of ${chunks.length} completed before this. Re-run from ${chunk.startDate}.`
                : ""),
          });
          return;
        }
        // Summarised rather than dumped: the raw envelope is hundreds of lines
        // of per-meter detail, and what a reader wants is whether it wrote
        // anything. The full body is still in the service's own logs.
        // How the result reads depends on what the job is FOR — a preview
        // summarised into "nothing to write" would have thrown away the only
        // thing it produced. See `resultView`.
        const view = job.resultView ?? "counts";
        if (view === "messages") {
          const messages = previewMessages(body?.result);
          setDetail({ messages });
          const groups = new Set(messages.map((entry) => entry.chatId)).size;
          results.push(
            messages.length
              ? `${messages.length} message${messages.length === 1 ? "" : "s"} to ${groups} group${groups === 1 ? "" : "s"}`
              : "nothing would be sent",
          );
        } else if (view === "json") {
          setDetail({ json: JSON.stringify(body?.result ?? null, null, 2) });
          results.push("read back below");
        } else {
          results.push(label ? `${label}: ${summariseJobResult(body?.result)}` : summariseJobResult(body?.result));
        }
      }
      setOutcome({ ok: true, text: results.join("\n").slice(0, 4000) });
    } catch (error) {
      setOutcome({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4" {...dismiss}>
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

        {job.choice ? (
          <>
            <label className="mt-4 block text-xs text-muted-foreground" htmlFor="job-choice">
              {job.choice.label}
            </label>
            <select
              id="job-choice"
              className={field}
              value={choice ?? ""}
              disabled={busy}
              onChange={(event) => {
                setChoice(event.target.value);
                // The previous answer described a different report.
                setOutcome(null);
                setDetail(null);
              }}
            >
              {job.choice.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {/* The selected option's own help, not the choice's — what this
                report is differs per option and is the thing being picked. */}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {job.choice.options.find((option) => option.value === choice)?.help ?? job.choice.help}
            </p>
          </>
        ) : null}

        {/* A dateless job acts on current state, so there is no range to ask
            for. Two empty date fields would read as something left unfilled. */}
        {job.dateless ? null : (
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
        )}

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

        {/* Which mode this run is in, in words.
            An unticked checkbox is not a statement, and "will this actually
            write?" is the question in an operator's hand before they press the
            button — so it is answered above the button rather than inferred. */}
        {job.appliesWhen ? (
          applies ? (
            <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[11px] text-danger">
              This run writes for real. Untick {job.appliesWhen} to preview it first.
            </p>
          ) : (
            <p className="mt-3 rounded-lg border border-on/40 bg-on/10 p-2.5 text-[11px] text-on">
              Dry run — nothing is written or sent. The result lists exactly what would change.
            </p>
          )
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

        {/* A long range is many requests; without this the button just sits
            there for minutes and the only honest reading is that it has hung. */}
        {progress ? (
          <p className="mt-3 rounded-lg border border-primary/40 bg-primary/10 p-2 font-mono text-[11px] text-primary">
            running… {progress}
          </p>
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

            {/* A preview's output IS the message. Shown per destination, with
                the group's name where the alias store knows it — a bare
                `1203…@g.us` does not tell anyone which site this is. */}
            {detail && "messages" in detail ? (
              detail.messages.length ? (
                <div className="mt-2 space-y-2">
                  {detail.messages.map((entry, index) => (
                    <div key={`${entry.chatId}-${index}`} className="rounded-lg border border-border bg-background/60 p-2">
                      <div className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate font-medium text-foreground">
                          {groupNames?.[entry.chatId] ?? entry.chatId ?? "unnamed destination"}
                        </span>
                        <span className="shrink-0">{entry.kind}</span>
                      </div>
                      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-foreground">
                        {entry.message}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Nothing would be sent. For a report that is a clean result, not a failure.
                </p>
              )
            ) : null}

            {/* A diagnostic's fields are the answer, so they are shown as they
                came rather than reduced to a sentence. */}
            {detail && "json" in detail ? (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre rounded-lg border border-border bg-background/60 p-2 font-mono text-[10px] text-foreground">
                {detail.json}
              </pre>
            ) : null}
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
