"use client";

import { useEffect, useState } from "react";

type MeterLimit = {
  project_code: string;
  meter_code: string;
  approved_ppv_mm_s: number;
  warning_percent: number;
  critical_percent: number;
  limit_percent: number;
  updated_at: string;
};

const fields = [
  { key: "approved_ppv_mm_s", label: "Approved PPV (mm/s)" },
  { key: "warning_percent", label: "Warning (%)" },
  { key: "critical_percent", label: "Critical (%)" },
  { key: "limit_percent", label: "Limit reached (%)" },
] as const;
type LimitField = (typeof fields)[number]["key"];
type LimitDraft = Record<LimitField, string>;
const draftFor = (row: MeterLimit): LimitDraft => ({
  approved_ppv_mm_s: String(row.approved_ppv_mm_s),
  warning_percent: String(row.warning_percent),
  critical_percent: String(row.critical_percent),
  limit_percent: String(row.limit_percent),
});

export function VibrationMeterLimits({ code, canEdit }: { code: string; canEdit: boolean }) {
  const [rows, setRows] = useState<MeterLimit[] | null>(null);
  const [draft, setDraft] = useState<Record<string, LimitDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/vibration/limits?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!alive) return;
        if (!response.ok) throw new Error(body.error || `status ${response.status}`);
        const limits = Array.isArray(body.limits) ? body.limits as MeterLimit[] : [];
        setRows(limits);
        setDraft(Object.fromEntries(limits.map((row) => [row.meter_code, draftFor(row)])));
      })
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { alive = false; };
  }, [code]);

  async function save(row: MeterLimit) {
    setBusy(row.meter_code);
    setError(null);
    try {
      const response = await fetch("/api/vibration/limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...row,
          ...Object.fromEntries(fields.map(({ key }) => [key, Number(draft[row.meter_code][key])])),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `status ${response.status}`);
      const saved = body.limit as MeterLimit;
      setRows((previous) => previous?.map((item) => item.meter_code === saved.meter_code ? saved : item) ?? null);
      setDraft((previous) => ({ ...previous, [saved.meter_code]: draftFor(saved) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pt-5" data-vibration-meter-limits>
      <h3 className="mb-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        PPV limits by meter
      </h3>
      <p className="px-2 text-xs text-muted-foreground">
        Provisional approved limit: 5.0 mm/s. Warning, critical and reached levels are percentages of each meter&apos;s approved limit. These settings do not send alerts yet.
      </p>
      {error ? <p className="px-2 py-2 text-xs text-danger">{error}</p> : null}
      {rows === null && !error ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading meter limits…</p> : null}
      {rows?.length === 0 ? <p className="px-2 py-2 text-xs text-warn">No meter limits are provisioned. Apply the Vibration meter PPV limits migration.</p> : null}
      {rows?.map((row) => {
        const editing = draft[row.meter_code] ?? draftFor(row);
        const approved = Number(editing.approved_ppv_mm_s);
        const changed = fields.some(({ key }) => Number(editing[key]) !== row[key]);
        return (
          <div key={row.meter_code} className="mt-3 rounded-lg border border-border p-3">
            <div className="mb-2 font-mono text-xs font-semibold">{row.meter_code}</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {fields.map(({ key, label }) => (
                <label key={key} className="flex flex-col gap-1 text-xs">
                  <span>{label}</span>
                  <input className="w-full rounded border border-border bg-background px-2 py-1 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-on" type="number" min="0" step="any"
                    value={editing[key]}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) => setDraft((previous) => ({
                      ...previous,
                      [row.meter_code]: { ...editing, [key]: event.target.value },
                    }))} />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Warning {(approved * Number(editing.warning_percent) / 100).toFixed(2)}, critical {(approved * Number(editing.critical_percent) / 100).toFixed(2)}, reached {(approved * Number(editing.limit_percent) / 100).toFixed(2)} mm/s.
            </p>
            {canEdit ? <button type="button" className="mt-2 rounded border border-border px-3 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-on disabled:opacity-50" disabled={busy !== null || !changed} onClick={() => void save(row)}>Save meter limit</button> : null}
          </div>
        );
      })}
    </section>
  );
}
