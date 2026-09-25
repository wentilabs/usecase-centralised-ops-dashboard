"use client";

import { useEffect, useState } from "react";
import { GroupPicker } from "./GroupPicker";

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

  useEffect(() => {
    const onLabelChange = (event: Event) => {
      const detail = (event as CustomEvent<{ projectCode?: string; oldLabel?: string; newLabel?: string }>).detail;
      if (detail?.projectCode !== projectCode || !detail.oldLabel || !detail.newLabel) return;
      setSensors((previous) => previous?.map((sensor) =>
        sensor.sensorLabel === detail.oldLabel ? { ...sensor, sensorLabel: detail.newLabel! } : sensor,
      ) ?? null);
    };
    window.addEventListener("wbgt-sensor-label-renamed", onLabelChange);
    return () => window.removeEventListener("wbgt-sensor-label-renamed", onLabelChange);
  }, [projectCode]);

  const mappings = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, string>
    : {};
  if (error) return <p className="py-2 text-xs text-danger">Could not load sensors: {error}</p>;
  if (!sensors) return <p className="py-2 text-xs text-muted-foreground">Loading sensors…</p>;
  if (!sensors.length) return <p className="py-2 text-xs text-muted-foreground">No active sensors found.</p>;

  return (
    <div className="space-y-2">
      {sensors.map((sensor) => (
        // Not a <label>: GroupPicker owns an input and a listbox, and wrapping
        // that in a label makes every click on an option re-focus the input.
        <div key={sensor.sensorLabel} className="grid gap-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-3">
          <span className="text-xs md:pt-2">
            {sensor.siteName ? `${sensor.siteName} — ` : ""}<code className="font-mono">{sensor.sensorLabel}</code>
          </span>
          {/* The same picker every other group field uses, in single mode.
              This was a <select> listing every group in the estate — hundreds
              of them, in id order, with no way to type. Searching by name is
              how groups are chosen everywhere else here. */}
          <GroupPicker
            single
            placeholder="Search for a group…"
            value={mappings[sensor.sensorLabel] ?? ""}
            groupNames={groupNames}
            onChange={(next) => {
              const rest = { ...mappings };
              // Clearing the pill removes the sensor from the map rather than
              // storing an empty string: the service fails closed on an
              // unmapped sensor, and "" would read as mapped-to-nothing.
              if (next) rest[sensor.sensorLabel] = next;
              else delete rest[sensor.sensorLabel];
              onChange(rest);
            }}
          />
        </div>
      ))}
    </div>
  );
}
