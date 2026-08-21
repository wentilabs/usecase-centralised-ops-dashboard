"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EXPORT_FORMATS, type ExportDefinition, type ExportFormat, type ExportPreflight } from "@/lib/jobs";
import type { ProjectConfigRow } from "@/lib/services";
import { useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * xlsx export: pick a project, then a workbook tab (WBGT) or a date window
 * (noise).
 *
 * The export depends on a Google Drive scope that may not be granted yet, so
 * choosing a project runs a **read-only preflight** against the service first.
 * Until that comes back ready, the button stays disabled and the dialog lists
 * each blocker with the exact fix — rather than letting someone press Export and
 * read a raw Google 403.
 */
export function ExportDialog({
  definition,
  rows,
  onClose,
}: {
  definition: ExportDefinition;
  rows: ProjectConfigRow[];
  onClose: () => void;
}) {
  const projects = useMemo(
    () =>
      rows
        .map((row) => String(row.project_code ?? ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const [projectCode, setProjectCode] = useState("");
  const [tab, setTab] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<ExportPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEscapeKey(!busy, onClose);

  const check = useCallback(
    async (code: string) => {
      setChecking(true);
      setPreflight(null);
      setError(null);
      setDone(null);
      try {
        const res = await fetch(`/api/exports/${definition.key}?preflight=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectCode: code }),
        });
        const body = await res.json();
        // A 503 from HALO itself still carries a blocker list, so render it.
        setPreflight(body as ExportPreflight);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [definition.key],
  );

  useEffect(() => {
    if (projectCode) void check(projectCode);
  }, [projectCode, check]);

  // Default the window to whatever the workbook actually covers.
  useEffect(() => {
    if (definition.choose !== "range" || !preflight) return;
    if (preflight.earliest_date && !from) setFrom(preflight.earliest_date);
    if (preflight.latest_date && !to) setTo(preflight.latest_date);
  }, [definition.choose, preflight, from, to]);

  const problems: string[] = [];
  if (!projectCode) problems.push("Choose a project.");
  if (definition.choose === "tab" && projectCode && !tab) problems.push("Choose which sheet to export.");
  if (definition.choose === "range") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) problems.push("From date must be YYYY-MM-DD.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) problems.push("To date must be YYYY-MM-DD.");
    if (from && to && from > to) problems.push("From is after To.");
  }
  const answered = typeof preflight?.ready === "boolean";
  const blocked = answered && preflight?.ready === false;
  // An unanswered preflight is its own state. Previously it disabled the button
  // while rendering nothing, which is how this dead-ended with no message.
  const unanswered = Boolean(preflight) && !answered;
  const canRun = problems.length === 0 && answered && preflight?.ready === true && !checking;

  /** Never leave the button disabled without saying why. */
  const disabledReason = checking
    ? "Checking access…"
    : !projectCode
      ? "Choose a project."
      : unanswered
        ? "The service did not return a readiness report — see the message above."
        : blocked
          ? "Blocked — see the reasons above."
          : problems.length
            ? problems[0]
            : null;

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/exports/${definition.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          definition.choose === "tab"
            ? { projectCode, tab, format }
            : { projectCode, from, to, format },
        ),
      });

      // A JSON body here means the service declined; a binary body is the file.
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || type.includes("application/json")) {
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.blockers) && body.blockers.length) {
          setPreflight(body as ExportPreflight);
          setError("The service refused the export — see the blockers above.");
        } else {
          setError(body.error ?? `HTTP ${res.status}`);
        }
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "export.xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDone(`${name} — ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-background p-4 shadow-2xl md:max-h-[85vh] md:w-[min(560px,92vw)] md:rounded-2xl md:p-5">
        <h3 className="text-base font-semibold">{definition.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>

        <label className="mt-4 block text-xs text-muted-foreground" htmlFor="export-project">
          Project
        </label>
        <select
          id="export-project"
          className={field}
          value={projectCode}
          disabled={busy}
          onChange={(event) => {
            setProjectCode(event.target.value);
            setTab("");
            setFrom("");
            setTo("");
          }}
        >
          <option value="">— choose a project —</option>
          {projects.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        {checking ? <p className="mt-2 text-[11px] text-muted-foreground">Checking access…</p> : null}

        {unanswered ? (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[11px]">
            <div className="font-semibold text-danger">No readiness report came back</div>
            <div className="mt-0.5 text-muted-foreground">
              The export endpoint may not be deployed on the {definition.service} service yet, or{" "}
              {definition.baseUrlEnv} may be pointing somewhere without it.
            </div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
              {JSON.stringify(preflight, null, 1).slice(0, 600)}
            </pre>
          </div>
        ) : null}

        {preflight?.service_account_email ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Using service account{" "}
            <span className="break-all font-mono text-[10px] text-foreground">
              {preflight.service_account_email}
            </span>{" "}
            — the workbook must be shared with this address.
          </p>
        ) : null}

        {preflight?.workbook_name ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Workbook: <span className="text-foreground">{preflight.workbook_name}</span>
          </p>
        ) : null}

        {/* The whole point of the preflight: name each missing permission and
            the exact fix, instead of surfacing a raw Google error later. */}
        {blocked ? (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
            <div className="text-xs font-semibold text-warn">Not available yet</div>
            <ul className="mt-1.5 flex flex-col gap-2">
              {(preflight?.blockers ?? []).map((blocker) => (
                <li key={blocker.code} className="text-[11px]">
                  <div className="font-semibold text-warn">{blocker.summary}</div>
                  <div className="mt-0.5 text-muted-foreground">{blocker.remedy}</div>
                  {blocker.detail ? (
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{blocker.detail}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {definition.choose === "tab" && answered && !preflight?.tabs?.length ? (
          <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] text-warn">
            No sheets could be listed for this workbook, so there is nothing to choose.{" "}
            {preflight?.tabs_error ?? "Check that the workbook is shared with the service account above."}
          </p>
        ) : null}

        {definition.choose === "tab" && preflight?.tabs?.length ? (
          <>
            <label className="mt-4 block text-xs text-muted-foreground" htmlFor="export-tab">
              Sheet
            </label>
            <select
              id="export-tab"
              className={field}
              value={tab}
              disabled={busy}
              onChange={(event) => setTab(event.target.value)}
            >
              <option value="">— choose a sheet —</option>
              {preflight.tabs.map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {definition.choose === "range" ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-muted-foreground" htmlFor="export-from">
                  From
                </label>
                <input
                  id="export-from"
                  type="date"
                  className={field}
                  value={from}
                  max={to || undefined}
                  disabled={busy}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground" htmlFor="export-to">
                  To
                </label>
                <input
                  id="export-to"
                  type="date"
                  className={field}
                  value={to}
                  min={from || undefined}
                  disabled={busy}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
            </div>
            {preflight?.available_dates?.length ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Workbook covers {preflight.earliest_date} → {preflight.latest_date} (
                {preflight.available_dates.length} day columns). Columns outside your window are removed from a
                temporary copy; the original is untouched.
              </p>
            ) : null}
          </>
        ) : null}

        {answered && preflight?.ready ? (
          <>
            <label className="mt-4 block text-xs text-muted-foreground" htmlFor="export-format">
              Format
            </label>
            <select
              id="export-format"
              className={field}
              value={format}
              disabled={busy}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              {EXPORT_FORMATS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {EXPORT_FORMATS.find((entry) => entry.key === format)?.help}
            </p>
          </>
        ) : null}

        {problems.length && projectCode && !blocked && !unanswered ? (
          <ul className="mt-3 list-inside list-disc text-[11px] text-warn">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[11px] text-danger">{error}</p>
        ) : null}
        {done ? (
          <p className="mt-3 rounded-lg border border-on/40 bg-on/10 p-3 text-[11px] text-on">Downloaded {done}</p>
        ) : null}

        {disabledReason && !busy ? (
          <p className="mt-3 text-[11px] text-muted-foreground">{disabledReason}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2 pb-safe">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2.5 text-sm disabled:opacity-50 md:py-1.5"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canRun || busy}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 md:py-1.5"
          >
            {busy ? "Exporting…" : `Export ${format}`}
          </button>
        </div>
      </div>
    </div>
  );
}
