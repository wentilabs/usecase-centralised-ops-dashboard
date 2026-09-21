"use client";

import { useEffect, useState } from "react";

type Sensor = { sensorLabel: string; siteName: string | null };

export function SensorGroupPicker({
  value,
  onChange,
  projectCode,
  groupNames,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  projectCode: string;
  groupNames: Record<string, string>;
}) {
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/wbgt-sensors?project=${encodeURIComponent(projectCode)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!alive) return;
        if (!response.ok) setError(body.error ?? `HTTP ${response.status}`);
        else setSensors(body.sensors ?? []);
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { alive = false; };
  }, [projectCode]);

  const mappings = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, string>
    : {};
  const groups = Object.entries(groupNames);
  if (error) return <p className="py-2 text-xs text-danger">Could not load sensors: {error}</p>;
  if (!sensors) return <p className="py-2 text-xs text-muted-foreground">Loading sensors…</p>;
  if (!sensors.length) return <p className="py-2 text-xs text-muted-foreground">No active sensors found.</p>;

  return (
    <div className="space-y-2">
      {sensors.map((sensor) => (
        <label key={sensor.sensorLabel} className="grid gap-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3">
          <span className="text-xs">
            {sensor.siteName ? `${sensor.siteName} — ` : ""}<code className="font-mono">{sensor.sensorLabel}</code>
          </span>
          <select
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            value={mappings[sensor.sensorLabel] ?? ""}
            onChange={(event) => onChange({ ...mappings, [sensor.sensorLabel]: event.target.value })}
          >
            <option value="">— choose one group —</option>
            {groups.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
