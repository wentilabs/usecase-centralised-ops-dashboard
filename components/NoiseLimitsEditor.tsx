"use client";

import { useMemo, useState } from "react";

import {
  diffBands,
  hourlyFor,
  parseLimitCell,
  type BandChange,
  type BandEdit,
  type LimitBand,
  type MeterLimits,
} from "@/lib/noise-limits";

/**
 * Editing one meter's permissible noise levels — [WRITE NOISE LIMITS].
 *
 * Three things this screen is shaped by, all recorded in
 * docs/WRITE_NOISE_LIMITS.md:
 *
 * **Protection is a choice, not a consequence of editing.** A correction
 * NoiseLynx should also carry is better left following NoiseLynx, so its page
 * stays the source of truth for that meter. The checkbox defaults to whatever
 * the meter already is, so saving does not silently change its standing.
 *
 * **The preview is the only validation there is.** The limit columns carry no
 * CHECK — intended — so nothing but a person reading this stops `6` where `61`
 * was meant. That is why the diff shows the old value beside the new one rather
 * than just the new one, and why a value outside the source page's 0–99 is
 * flagged and still allowed.
 *
 * **A 12hr edit can move the hourly threshold.** With no Leq1hr in a band the
 * assessment borrows Leq12hr, so the preview carries the hourly consequence on
 * every change of a band, not only on the Leq1hr cell.
 */
export function NoiseLimitsEditor({
  projectCode,
  meter,
  onCancel,
  onSaved,
}: {
  projectCode: string;
  meter: MeterLimits;
  onCancel: () => void;
  onSaved: (meters: MeterLimits[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(() => initialDraft(meter));
  const [protect, setProtect] = useState(meter.isProtected);
  const [provenance, setProvenance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useMemo(() => readDraft(meter, draft), [meter, draft]);

  const cellError = read.problems.length > 0;
  const nothingToDo = !read.changes.length && protect === meter.isProtected;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/noise-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectCode,
          fullIdentifier: meter.fullIdentifier,
          // Every band of both day types, not only the changed ones: protection
          // is per row, and a meter marked from a partial write is the state
          // TRI NM01 is in — half frozen, half still refreshed.
          bands: read.bands,
          protect,
          provenance,
          baseImportedAt: meter.importedAt,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `status ${res.status}`);
      onSaved(body.meters ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-0 md:grid-cols-2">
        <EditTable
          title="Mon–Sat"
          dayType="mon_sat"
          bands={meter.monSat}
          draft={draft}
          onChange={setDraft}
        />
        <EditTable
          title="Sun & public holiday"
          dayType="sun_ph"
          bands={meter.sunPh}
          draft={draft}
          onChange={setDraft}
          className="md:border-l md:border-border"
        />
      </div>

      <div className="space-y-2 border-t border-border px-3 py-3">
        <label className="flex items-start gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={protect}
            onChange={(event) => setProtect(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong className="font-medium">Protect from the limits refresh</strong>
            <span className="block text-muted-foreground">
              {protect
                ? "These values are kept when the refresh runs. Use this when NoiseLynx is not the source — a permit condition, an NEA letter, an agreed adjustment."
                : "The next refresh replaces these values with whatever the NoiseLynx page holds. Right when the page should stay the source of truth."}
              {meter.isProtected && !protect ? (
                <span className="mt-1 block text-warn">
                  This meter is protected today. Unticking does not remove the existing marker — clearing one
                  is not something this screen does.
                </span>
              ) : null}
            </span>
          </span>
        </label>

        {protect ? (
          <label className="block text-xs">
            <span className="text-muted-foreground">Where these numbers come from</span>
            <input
              value={provenance}
              onChange={(event) => setProvenance(event.target.value)}
              placeholder="NEA letter 2026-09-08 / permit condition 4.2 / agreed with the client"
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            />
            <span className="mt-1 block text-muted-foreground">
              Stored after the marker, and the only record of why this meter differs from its vendor page.
            </span>
          </label>
        ) : null}
      </div>

      <Preview
        changes={read.changes}
        problems={read.problems}
        warnings={read.warnings}
        protect={protect}
        wasProtected={meter.isProtected}
      />

      {error ? (
        <p className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || cellError || nothingToDo}
          onClick={save}
          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
        >
          {saving ? "Saving…" : nothingToDo ? "No change" : `Save ${read.changes.length || "protection"}`}
        </button>
      </div>
    </div>
  );
}

const METRICS = [
  ["leq5min", "Leq5min"],
  ["leq1hr", "Leq1hr"],
  ["leq12hr", "Leq12hr"],
] as const;

function keyOf(band: { startMinutes: number; endMinutes: number }) {
  return `${band.startMinutes}-${band.endMinutes}`;
}

function initialDraft(meter: MeterLimits) {
  const draft: Record<string, Record<string, string>> = {};
  for (const [dayType, bands] of [["mon_sat", meter.monSat], ["sun_ph", meter.sunPh]] as const) {
    for (const band of bands) {
      draft[`${dayType}|${keyOf(band)}`] = {
        leq5min: band.leq5min === null ? "" : String(band.leq5min),
        leq1hr: band.leq1hr === null ? "" : String(band.leq1hr),
        leq12hr: band.leq12hr === null ? "" : String(band.leq12hr),
      };
    }
  }
  return draft;
}

/** The draft turned into values, the diff against what is stored, and anything unreadable. */
function readDraft(meter: MeterLimits, draft: Record<string, Record<string, string>>) {
  const problems: string[] = [];
  const warnings: string[] = [];
  const bands: (BandEdit & { dayType: "mon_sat" | "sun_ph" })[] = [];
  const changes: BandChange[] = [];

  for (const [dayType, current] of [["mon_sat", meter.monSat], ["sun_ph", meter.sunPh]] as const) {
    const edited: Record<string, BandEdit> = {};
    for (const band of current) {
      const cells = draft[`${dayType}|${keyOf(band)}`] ?? {};
      const parsed = METRICS.map(([field, label]) => {
        const result = parseLimitCell(cells[field] ?? "");
        if (result.error) problems.push(`${band.label} ${label}: ${result.error}`);
        if (result.warning) warnings.push(`${band.label} ${label}: ${result.warning}`);
        return result.value;
      });
      const edit: BandEdit = {
        startMinutes: band.startMinutes,
        endMinutes: band.endMinutes,
        leq5min: parsed[0],
        leq1hr: parsed[1],
        leq12hr: parsed[2],
      };
      edited[keyOf(band)] = edit;
      bands.push({ ...edit, dayType });
    }
    changes.push(...diffBands(dayType, current, edited));
  }
  return { bands, changes, problems, warnings };
}

function EditTable({
  title,
  dayType,
  bands,
  draft,
  onChange,
  className = "",
}: {
  title: string;
  dayType: "mon_sat" | "sun_ph";
  bands: LimitBand[];
  draft: Record<string, Record<string, string>>;
  onChange: (next: Record<string, Record<string, string>>) => void;
  className?: string;
}) {
  const set = (band: LimitBand, field: string, value: string) =>
    onChange({
      ...draft,
      [`${dayType}|${keyOf(band)}`]: { ...draft[`${dayType}|${keyOf(band)}`], [field]: value },
    });

  return (
    <div className={`overflow-x-auto p-3 ${className}`}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Band</th>
            <th className="py-1 pr-1 text-right font-medium">Leq5min</th>
            <th className="py-1 pr-1 text-right font-medium">Leq1hr</th>
            <th className="py-1 pr-1 text-right font-medium">Leq12hr</th>
            <th className="py-1 text-right font-medium">Hourly</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => {
            const cells = draft[`${dayType}|${keyOf(band)}`] ?? {};
            const hourly = hourlyFor(
              parseLimitCell(cells.leq1hr ?? "").value,
              parseLimitCell(cells.leq12hr ?? "").value,
            );
            return (
              <tr key={keyOf(band)} className="border-t border-border/60">
                <td className="py-1 pr-2 whitespace-nowrap text-foreground">
                  {band.label}
                  <span className="ml-1 text-muted-foreground">{band.hours}h</span>
                </td>
                {METRICS.map(([field]) => (
                  <td key={field} className="py-1 pr-1 text-right">
                    <input
                      value={cells[field] ?? ""}
                      onChange={(event) => set(band, field, event.target.value)}
                      inputMode="decimal"
                      // Blank is a value here, so the placeholder says what it
                      // means rather than looking like an empty box.
                      placeholder="none"
                      className="w-14 rounded border border-border bg-background px-1 py-0.5 text-right text-xs text-foreground"
                    />
                  </td>
                ))}
                <td className="py-1 text-right whitespace-nowrap text-[11px]">
                  {hourly.limit === null ? (
                    <span className="text-warn">none</span>
                  ) : hourly.borrowedFrom12hr ? (
                    <span className="text-primary">{hourly.limit} ← 12hr</span>
                  ) : (
                    <span className="text-muted-foreground">{hourly.limit}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Preview({
  changes,
  problems,
  warnings,
  protect,
  wasProtected,
}: {
  changes: BandChange[];
  problems: string[];
  warnings: string[];
  protect: boolean;
  wasProtected: boolean;
}) {
  const rows = changes.reduce((total, change) => total + change.hours, 0);
  return (
    <div className="mx-3 rounded-xl border border-border bg-background/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Preview{changes.length ? ` — ${changes.length} change${changes.length === 1 ? "" : "s"}, ${rows} row${rows === 1 ? "" : "s"}` : ""}
      </p>

      {problems.map((problem) => (
        <p key={problem} className="mt-1.5 text-xs text-danger">
          {problem}
        </p>
      ))}
      {warnings.map((warning) => (
        <p key={warning} className="mt-1.5 text-xs text-warn">
          {warning}
        </p>
      ))}

      {!changes.length ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {protect === wasProtected
            ? "Nothing changed yet."
            : protect
              ? "No values change — this save only marks the meter as protected from the refresh."
              : "No values change."}
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {changes.map((change, index) => {
            const hourlyMoved =
              change.hourlyBefore.limit !== change.hourlyAfter.limit ||
              change.hourlyBefore.borrowedFrom12hr !== change.hourlyAfter.borrowedFrom12hr;
            return (
              <li key={`${change.dayType}-${change.label}-${change.metric}-${index}`} className="text-xs">
                <span className="text-muted-foreground">
                  {change.dayType === "mon_sat" ? "Mon–Sat" : "Sun & PH"} {change.label}
                </span>{" "}
                <span className="text-foreground">{change.metric}</span>{" "}
                <span className="tabular-nums text-muted-foreground">{change.from ?? "none"}</span>
                <span className="text-muted-foreground"> → </span>
                <span className="tabular-nums font-medium text-foreground">{change.to ?? "none"}</span>
                <span className="text-muted-foreground"> ({change.hours} row{change.hours === 1 ? "" : "s"})</span>
                {hourlyMoved ? (
                  // The consequence that is invisible in the grid: with no Leq1hr
                  // the hourly assessment borrows Leq12hr, so a 12hr edit moves
                  // the hourly threshold too.
                  <span className="ml-1 text-primary">
                    hourly {describeHourly(change.hourlyBefore)} → {describeHourly(change.hourlyAfter)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {protect !== wasProtected ? (
        <p className="mt-2 text-xs text-primary">
          {protect
            ? "🔒 Marked as manual source of truth — the refresh will keep these values."
            : "The existing marker is left in place; this save does not remove protection."}
        </p>
      ) : null}
    </div>
  );
}

function describeHourly(hourly: { limit: number | null; borrowedFrom12hr: boolean }) {
  if (hourly.limit === null) return "none";
  return hourly.borrowedFrom12hr ? `${hourly.limit} (from 12hr)` : String(hourly.limit);
}
