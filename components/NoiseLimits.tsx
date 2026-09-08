"use client";

import { useEffect, useState } from "react";

import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { NoiseLimitsEditor } from "./NoiseLimitsEditor";
import type { LimitBand, MeterLimits } from "@/lib/noise-limits";

/**
 * The permissible noise levels a project's meters are assessed against.
 *
 * Read-only. These rows are written by `/api/noise-limit-refresh`, which scrapes
 * each meter's NoiseLynx DeviceAdmin page, or by hand for a meter whose numbers
 * come from a source outside NoiseLynx — a permit condition, an NEA letter, an
 * agreed adjustment. HALO shows them so the assessment can be checked against
 * that source without opening NoiseLynx meter by meter.
 *
 * Two things it exists to make visible, because neither is legible in NoiseLynx:
 *
 * 1. **Which meters survive the refresh.** A row is kept only if its
 *    `source_file` says "manual source of truth"; anything else is overwritten
 *    on the next run. A meter holding hand-entered numbers WITHOUT that marker
 *    is a silent revert waiting to happen, so protection is stated per meter.
 * 2. **What the hourly assessment actually compares against.** NoiseLynx writes
 *    `0` both for "no Leq1hr limit here" and for "no Leq12hr limit here", and
 *    the service falls back from the first to the second — so the same `0` means
 *    "borrowed 76" in one band and "no limit at all" in the next.
 */
export function NoiseLimits({
  projectCode,
  canEdit,
  onClose,
}: {
  projectCode: string;
  /** A reader sees the tables and no Edit button. The view itself stays open to them. */
  canEdit: boolean;
  onClose: () => void;
}) {
  const [meters, setMeters] = useState<MeterLimits[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock(true);

  useEffect(() => {
    let alive = true;
    setMeters(null);
    setError(null);
    fetch(`/api/noise-limits?project=${encodeURIComponent(projectCode)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) setError(body?.error || `status ${res.status}`);
        else setMeters(body.meters ?? []);
      })
      .catch((cause) => alive && setError(String(cause)));
    return () => {
      alive = false;
    };
  }, [projectCode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const protectedCount = (meters ?? []).filter((meter) => meter.isProtected).length;
  /** `full_identifier` of the meter being edited, or null. One at a time. */
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/85 p-3 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 md:px-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {projectCode} — permissible noise levels
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What each meter is assessed against, as stored.
              {meters
                ? ` ${meters.length} meter${meters.length === 1 ? "" : "s"}${
                    protectedCount ? `, ${protectedCount} protected from the refresh` : ""
                  }.`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Close
          </button>
        </header>

        <div className="space-y-5 px-4 py-4 md:px-6">
          {error ? (
            <p className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>
          ) : null}
          {!meters && !error ? <p className="text-sm text-muted-foreground">Reading limits…</p> : null}
          {meters && !meters.length ? (
            <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              No limit rows for {projectCode}. Nothing is being assessed against a limit — run the limits
              refresh, or enter them for a meter whose source is not NoiseLynx.
            </p>
          ) : null}
          {(meters ?? []).map((meter) => (
            <MeterBlock
              key={meter.fullIdentifier}
              projectCode={projectCode}
              meter={meter}
              canEdit={canEdit}
              editing={editing === meter.fullIdentifier}
              onEdit={() => setEditing(meter.fullIdentifier)}
              onCancel={() => setEditing(null)}
              onSaved={(next) => {
                setMeters(next);
                setEditing(null);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MeterBlock({
  projectCode,
  meter,
  canEdit,
  editing,
  onEdit,
  onCancel,
  onSaved,
}: {
  projectCode: string;
  meter: MeterLimits;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (meters: MeterLimits[]) => void;
}) {
  return (
    <section className="rounded-xl border border-border">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">{meter.meterLoc}</span>
        {meter.isProtected ? (
          // The one badge on this screen that changes what happens rather than
          // describing it: a protected meter's numbers survive the next refresh.
          // Partly is a real state — see monSatProtected/sunPhProtected — and it
          // is said out loud, because "protected" over a day type that is in fact
          // refreshed is the one wrong answer that costs something.
          <span
            className="rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
            title="source_file says “manual source of truth”, so the limits refresh keeps these values instead of taking NoiseLynx's"
          >
            {meter.monSatProtected && meter.sunPhProtected
              ? "🔒 protected from refresh"
              : `🔒 partly protected — ${meter.monSatProtected ? "Mon–Sat only" : "Sun & PH only"}`}
          </span>
        ) : (
          <span
            className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title="The next limits refresh overwrites these values with whatever the NoiseLynx DeviceAdmin page holds"
          >
            follows NoiseLynx
          </span>
        )}
        {meter.recId ? (
          <span className="text-[11px] text-muted-foreground">RecID {meter.recId}</span>
        ) : null}
        {meter.subscriptionEndDate ? (
          <span className="text-[11px] text-muted-foreground">
            subscription to {meter.subscriptionEndDate}
          </span>
        ) : null}
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto rounded-lg border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
          >
            ⚙︎ Edit limits
          </button>
        ) : null}
      </header>
      {meter.sourceFile ? (
        <p className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Source: {meter.sourceFile}
        </p>
      ) : null}
      {editing ? (
        <NoiseLimitsEditor
          projectCode={projectCode}
          meter={meter}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      ) : (
        <div className="grid gap-0 md:grid-cols-2">
          <BandTable title="Mon–Sat" bands={meter.monSat} isProtected={meter.monSatProtected} />
          <BandTable
            title="Sun & public holiday"
            bands={meter.sunPh}
            isProtected={meter.sunPhProtected}
            className="md:border-l md:border-border"
          />
        </div>
      )}
    </section>
  );
}

function BandTable({
  title,
  bands,
  isProtected,
  className = "",
}: {
  title: string;
  bands: LimitBand[];
  /** These rows survive the refresh. Shown per table because it is stored per row. */
  isProtected: boolean;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto p-3 ${className}`}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {isProtected ? (
          <span className="text-primary" title="These rows survive the limits refresh">
            🔒
          </span>
        ) : null}
      </p>
      {!bands.length ? (
        <p className="text-xs text-muted-foreground">No rows stored.</p>
      ) : (
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Band</th>
              <th className="py-1 pr-2 text-right font-medium">Leq5min</th>
              <th className="py-1 pr-2 text-right font-medium">Leq1hr</th>
              <th className="py-1 pr-2 text-right font-medium">Leq12hr</th>
              <th className="py-1 text-right font-medium">Hourly applied</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band) => (
              <tr key={`${band.startMinutes}-${band.endMinutes}`} className="border-t border-border/60">
                <td className="py-1 pr-2 whitespace-nowrap text-foreground">{band.label}</td>
                <td className="py-1 pr-2 text-right text-foreground">{band.leq5min ?? "—"}</td>
                <td className="py-1 pr-2 text-right text-foreground">{band.leq1hr ?? "—"}</td>
                <td className="py-1 pr-2 text-right text-foreground">{band.leq12hr ?? "—"}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  {band.hourly.limit === null ? (
                    // Not a blank: no hourly limit means an hourly exceedance
                    // cannot be reported for this band at all, which is a
                    // configuration fact worth reading as one.
                    <span className="text-warn" title="No Leq1hr and no Leq12hr, so nothing is compared hourly in this band">
                      none
                    </span>
                  ) : band.hourly.borrowedFrom12hr ? (
                    <span className="text-primary" title="No Leq1hr in this band, so the service compares against the Leq12hr limit and says so in the message">
                      {band.hourly.limit} ← 12hr
                    </span>
                  ) : (
                    <span className="text-foreground">{band.hourly.limit}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
