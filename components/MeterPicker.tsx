"use client";

import { useEffect, useMemo, useState } from "react";

import { buildToggles, serializeSelection, type Meter } from "@/lib/meter-selection";

/**
 * Which noise meters reach the client-facing messages, as a spread of pill
 * toggles labelled by meter name.
 *
 * A bare RecID like `6408` is unreadable, so the pills show
 * `noise_limits.noise_meter_loc` and keep the id as a subtitle. Stored form is
 * unchanged: the same comma-separated RecID list the noise service parses.
 *
 * Everything is on when the column is blank, and turning everything back on
 * writes blank again rather than listing every id — an exhaustive list would
 * freeze today's meters, so a meter added later would silently stop reaching the
 * client.
 */
export function MeterPicker({
  value,
  onChange,
  projectCode,
}: {
  /** Comma-separated RecIDs, exactly as stored. */
  value: string;
  onChange: (next: string) => void;
  projectCode: string;
}) {
  const [meters, setMeters] = useState<Meter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectCode) return;
    let alive = true;
    setMeters(null);
    setError(null);
    fetch(`/api/noise-meters?project=${encodeURIComponent(projectCode)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
        else setMeters(body.meters ?? []);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [projectCode]);

  const toggles = useMemo(() => buildToggles(value, meters ?? []), [value, meters]);
  const filtered = value.trim().length > 0;
  const enabledCount = toggles.filter((toggle) => toggle.enabled).length;

  function flip(recId: string) {
    onChange(
      serializeSelection(
        toggles.map((toggle) => (toggle.recId === recId ? { ...toggle, enabled: !toggle.enabled } : toggle)),
      ),
    );
  }

  if (error) {
    return <p className="py-2 text-xs text-danger">Could not load meters: {error}</p>;
  }
  if (meters === null) {
    return <p className="py-2 text-xs text-muted-foreground">Loading meters…</p>;
  }
  if (!meters.length) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        No active meters found for {projectCode} in <code className="font-mono">noise_limits</code>, so there is
        nothing to filter. Leave this blank.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {toggles.map((toggle) => {
          const disabled = toggle.issue === "no-rec-id";
          const title = disabled
            ? "This meter has no RecID, so no allowlist can name it — it cannot reach the client once filtering is on."
            : toggle.issue === "unknown"
              ? `RecID ${toggle.recId} is not an active meter on this project. The service logs an error and omits it — switch it off to clean up.`
              : `RecID ${toggle.recId}`;
          return (
            <button
              key={toggle.recId || toggle.name}
              type="button"
              role="switch"
              aria-checked={toggle.enabled}
              disabled={disabled}
              title={title}
              onClick={() => !disabled && flip(toggle.recId)}
              className={[
                "flex min-h-11 flex-col items-start rounded-xl border px-2.5 py-1.5 text-left md:min-h-0",
                toggle.enabled
                  ? "border-on/40 bg-on/15 text-on"
                  : "border-border bg-muted text-muted-foreground line-through",
                toggle.issue === "unknown" ? "border-warn/50 bg-warn/10 text-warn no-underline" : "",
                disabled ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              <span className="text-xs font-medium">
                {toggle.enabled ? "✓ " : ""}
                {toggle.name}
                {toggle.issue === "unknown" ? " (unknown)" : ""}
                {toggle.issue === "no-rec-id" ? " (no RecID)" : ""}
              </span>
              <span className="font-mono text-[10px] opacity-70">{toggle.recId || "—"}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {filtered
            ? `${enabledCount} of ${toggles.length} meters sent to the client`
            : `All ${toggles.length} meters sent — column blank, so new meters are included automatically`}
        </span>
        {filtered ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-md border border-border px-2 py-0.5 hover:border-primary hover:text-primary"
          >
            Reset to all
          </button>
        ) : null}
      </div>
    </div>
  );
}
