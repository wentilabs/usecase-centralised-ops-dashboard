"use client";

import { useEffect, useState } from "react";

type Sensor = { id: number; sensorLabel: string; siteName: string | null; updatedAt: string };

export function WbgtSensorLabelEditor({ projectCode, canEdit, onRenamed }: {
  projectCode: string;
  canEdit: boolean;
  onRenamed: (oldLabel: string, newLabel: string, config: Record<string, unknown> | null) => void;
}) {
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/wbgt-sensors?project=${encodeURIComponent(projectCode)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!alive) return;
        if (!response.ok) setError(body.error ?? `Could not load sensors (${response.status}).`);
        else setSensors(body.sensors ?? []);
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { alive = false; };
  }, [projectCode]);

  async function save(sensor: Sensor) {
    const sensorLabel = drafts[sensor.id] ?? sensor.sensorLabel;
    setBusy(sensor.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/wbgt-sensors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectCode,
          id: sensor.id,
          sensorLabel,
          baseSensorLabel: sensor.sensorLabel,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.current) {
          setSensors((previous) => previous?.map((entry) => entry.id === sensor.id ? body.current : entry) ?? null);
        }
        setError(body.error ?? `Could not save sensor label (${response.status}).`);
        return;
      }
      if (body.unchanged) {
        setDrafts((previous) => { const next = { ...previous }; delete next[sensor.id]; return next; });
        setEditing(null);
        setNotice("Label is already current.");
        return;
      }
      setSensors((previous) => previous?.map((entry) => entry.id === sensor.id ? body.sensor : entry) ?? null);
      onRenamed(sensor.sensorLabel, body.sensor.sensorLabel, body.config ?? null);
      window.dispatchEvent(new CustomEvent("wbgt-sensor-label-renamed", {
        detail: { projectCode, oldLabel: sensor.sensorLabel, newLabel: body.sensor.sensorLabel },
      }));
      setDrafts((previous) => { const next = { ...previous }; delete next[sensor.id]; return next; });
      setEditing(null);
      setNotice(body.audit?.sensor?.annotated === false
        ? "Sensor label saved. It will be used on the next scrape; optional audit setup is not installed yet."
        : "Sensor label saved. It will be used on the next scrape.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pt-5" aria-labelledby="wbgt-sensor-label-heading">
      <h3 id="wbgt-sensor-label-heading" className="mb-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        CloudLynx sensor labels
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Exact labels from the CloudLynx device list. Changes affect the next WBGT scrape.
      </p>
      {sensors === null && !error ? <p className="text-xs text-muted-foreground">Loading sensors…</p> : null}
      {sensors?.length === 0 ? <p className="text-xs text-muted-foreground">No active sensors found.</p> : null}
      <div className="space-y-2">
        {sensors?.map((sensor) => {
          const isEditing = editing === sensor.id;
          const value = drafts[sensor.id] ?? sensor.sensorLabel;
          const dirty = value !== sensor.sensorLabel;
          return (
            <div key={sensor.id} className="grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
              <div className="text-xs text-muted-foreground">{sensor.siteName || projectCode}</div>
              {isEditing ? (
                <input
                  aria-label={`CloudLynx label for ${sensor.siteName || projectCode}`}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
                  value={value}
                  maxLength={200}
                  autoFocus
                  onChange={(event) => setDrafts((previous) => ({ ...previous, [sensor.id]: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === "Escape") { setDrafts((previous) => ({ ...previous, [sensor.id]: sensor.sensorLabel })); setEditing(null); } }}
                />
              ) : (
                <code className="break-all font-mono text-sm">{sensor.sensorLabel}</code>
              )}
              {canEdit ? (
                isEditing ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={!dirty || busy === sensor.id} onClick={() => void save(sensor)} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                      {busy === sensor.id ? "Saving…" : "Save label"}
                    </button>
                    <button type="button" disabled={busy === sensor.id} onClick={() => { setDrafts((previous) => ({ ...previous, [sensor.id]: sensor.sensorLabel })); setEditing(null); }} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setError(null); setNotice(null); setEditing(sensor.id); }} className="rounded-lg border border-border px-3 py-2 text-xs hover:border-primary">
                    Edit label
                  </button>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
      {notice ? <p role="status" className="mt-2 text-xs text-on">{notice}</p> : null}
      {!canEdit ? <p className="mt-2 text-xs text-muted-foreground">Read-only account — sensor labels cannot be changed.</p> : null}
    </section>
  );
}
