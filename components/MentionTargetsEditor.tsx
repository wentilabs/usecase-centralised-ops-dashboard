"use client";

type ShiftConfig = {
  start_time: string;
  end_time: string;
  camera_targets: Record<string, string>;
};

type MentionTargets = {
  enabled: boolean;
  pending_enabled: boolean;
  non_compliant_enabled: boolean;
  day_shift: ShiftConfig;
  night_shift: ShiftConfig;
};

const EMPTY: MentionTargets = {
  enabled: false,
  pending_enabled: true,
  non_compliant_enabled: true,
  day_shift: { start_time: "07:00", end_time: "19:00", camera_targets: {} },
  night_shift: { start_time: "19:00", end_time: "07:00", camera_targets: {} },
};

function config(value: unknown): MentionTargets {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(EMPTY);
  const raw = value as Partial<MentionTargets>;
  const shift = (input: Partial<ShiftConfig> | undefined, fallback: ShiftConfig): ShiftConfig => ({
    start_time: input?.start_time || fallback.start_time,
    end_time: input?.end_time || fallback.end_time,
    camera_targets: input?.camera_targets && typeof input.camera_targets === "object" && !Array.isArray(input.camera_targets)
      ? input.camera_targets
      : {},
  });
  return {
    enabled: raw.enabled === true,
    pending_enabled: raw.pending_enabled !== false,
    non_compliant_enabled: raw.non_compliant_enabled !== false,
    day_shift: shift(raw.day_shift, EMPTY.day_shift),
    night_shift: shift(raw.night_shift, EMPTY.night_shift),
  };
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-4 rounded-lg border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function MentionTargetsEditor({ value, onChange }: { value: unknown; onChange: (value: MentionTargets) => void }) {
  const current = config(value);
  const update = (next: Partial<MentionTargets>) => onChange({ ...current, ...next });
  const updateShift = (name: "day_shift" | "night_shift", next: Partial<ShiftConfig>) => {
    update({ [name]: { ...current[name], ...next } });
  };

  function shiftEditor(name: "day_shift" | "night_shift", title: string) {
    const shift = current[name];
    const entries = Object.entries(shift.camera_targets);
    return (
      <section className="rounded-xl border border-border p-3 md:p-4" aria-label={`${title} mention settings`}>
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Start time
            <input type="time" value={shift.start_time} onChange={(event) => updateShift(name, { start_time: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground">End time
            <input type="time" value={shift.end_time} onChange={(event) => updateShift(name, { end_time: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {entries.map(([label, contacts], index) => (
            <div key={`${label}-${index}`} className="grid gap-2 rounded-lg bg-muted/30 p-2 sm:grid-cols-[minmax(130px,0.8fr)_minmax(180px,1.4fr)_auto]">
              <label className="text-[11px] text-muted-foreground">Camera label
                {label.toLowerCase() === "any" ? (
                  <div className="mt-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground">any</div>
                ) : (
                  <input value={label} onChange={(event) => {
                    const targets = { ...shift.camera_targets };
                    const nextLabel = event.target.value;
                    if (nextLabel.toLowerCase() === "any" || Object.keys(targets).some((entry) => entry !== label && entry.toLowerCase() === nextLabel.trim().toLowerCase())) return;
                    delete targets[label];
                    if (nextLabel.trim()) targets[nextLabel] = contacts;
                    updateShift(name, { camera_targets: targets });
                  }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground" placeholder="e.g. MBS-VSS-4X- 2" />
                )}
              </label>
              <label className="text-[11px] text-muted-foreground">Contact numbers, comma-separated
                <input value={contacts} onChange={(event) => updateShift(name, { camera_targets: { ...shift.camera_targets, [label]: event.target.value } })} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground" placeholder="6593656469, 65…" />
              </label>
              <button type="button" aria-label={`Remove ${label} target from ${title}`} onClick={() => {
                const targets = { ...shift.camera_targets };
                delete targets[label];
                updateShift(name, { camera_targets: targets });
              }} className="self-end rounded-lg border border-border px-3 py-2 text-xs text-danger">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => {
            const targets = { ...shift.camera_targets };
            let index = 1;
            while (`Camera ${index}` in targets) index += 1;
            targets[`Camera ${index}`] = "";
            updateShift(name, { camera_targets: targets });
          }} className="rounded-lg border border-border px-3 py-2 text-xs">＋ Add camera</button>
          {!Object.keys(shift.camera_targets).some((label) => label.toLowerCase() === "any") ? (
            <button type="button" onClick={() => updateShift(name, { camera_targets: { ...shift.camera_targets, any: "" } })} className="ml-2 rounded-lg border border-border px-3 py-2 text-xs">＋ Add any camera</button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <Switch label="Mention targets" checked={current.enabled} onChange={(enabled) => update({ enabled })} />
      {current.enabled ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Switch label="Tag PENDING forwards" checked={current.pending_enabled} onChange={(pending_enabled) => update({ pending_enabled })} />
            <Switch label="Tag non-compliant alerts" checked={current.non_compliant_enabled} onChange={(non_compliant_enabled) => update({ non_compliant_enabled })} />
          </div>
          <p className="text-xs text-muted-foreground">A camera-specific target wins over <code>any</code> in the same shift. Times use the project timezone. If the configured windows overlap or leave a gap, no target is selected during the ambiguous time.</p>
          <div className="grid gap-3 xl:grid-cols-2">
            {shiftEditor("day_shift", "Day shift")}
            {shiftEditor("night_shift", "Night shift")}
          </div>
        </>
      ) : <p className="text-xs text-muted-foreground">No one is tagged while this switch is off.</p>}
    </div>
  );
}
