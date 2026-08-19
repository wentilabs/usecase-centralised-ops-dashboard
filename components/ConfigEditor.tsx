"use client";

import { useEffect, useMemo, useState } from "react";

import { formatSgt } from "@/lib/card-summary";
import type { FieldSpec, ServiceFieldSpec } from "@/lib/field-spec";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";

type Draft = Record<string, unknown>;

type AuditEntry = {
  id: string;
  at: string;
  actor_email: string | null;
  note: string | null;
  external: boolean;
  changes: Record<string, { from: unknown; to: unknown }>;
};

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** A field is shown only while its controlling toggle holds the required value. */
function isVisible(field: FieldSpec, values: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  return JSON.stringify(values[field.showIf.field] ?? null) === JSON.stringify(field.showIf.equals);
}

function Control({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const base = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";

  if (field.readonly) {
    return <div className="px-3 py-2 font-mono text-xs text-muted-foreground">{display(value)}</div>;
  }

  if (field.widget === "toggle") {
    const on = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className="flex min-h-11 items-center gap-2.5 md:min-h-0"
      >
        <span
          className={`relative h-6 w-11 rounded-full transition ${on ? "bg-on" : "bg-muted ring-1 ring-border"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-[22px]" : "left-0.5"}`}
          />
        </span>
        <span className="text-xs text-muted-foreground">{on ? "on" : "off"}</span>
      </button>
    );
  }

  if (field.widget === "select") {
    return (
      <select className={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— not set —</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.widget === "multi") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-3 pt-1.5">
        {(field.options ?? []).map((option) => (
          <label key={option} className="flex min-h-11 items-center gap-1.5 text-sm md:min-h-0">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...selected, option] : selected.filter((entry) => entry !== option),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (field.widget === "number") {
    return (
      <input
        className={base}
        type="number"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }

  if (field.widget === "csv") {
    return (
      <textarea
        className={`${base} min-h-[62px] font-mono text-xs`}
        spellCheck={false}
        placeholder="comma-separated"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      className={base}
      type="text"
      spellCheck={false}
      placeholder={field.widget === "hhmm" ? "HHMM e.g. 0730" : undefined}
      maxLength={field.widget === "hhmm" ? 4 : undefined}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ConfigEditor({
  service,
  serviceLabel,
  spec,
  row,
  rowId,
  onClose,
  onSaved,
}: {
  service: ServiceKey;
  serviceLabel: string;
  spec: ServiceFieldSpec;
  row: ProjectConfigRow;
  rowId: string;
  onClose: () => void;
  onSaved: (updated: ProjectConfigRow) => void;
}) {
  const [current, setCurrent] = useState<ProjectConfigRow>(row);
  const [draft, setDraft] = useState<Draft>({});
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);

  const values = useMemo(() => ({ ...current, ...draft }) as Record<string, unknown>, [current, draft]);

  const changes = useMemo(() => {
    const out: Record<string, { from: unknown; to: unknown; label: string }> = {};
    for (const [name, value] of Object.entries(draft)) {
      const before = (current as Record<string, unknown>)[name] ?? null;
      const after = value ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        out[name] = { from: before, to: after, label: spec.fields[name]?.label ?? name };
      }
    }
    return out;
  }, [draft, current, spec.fields]);

  const dirtyCount = Object.keys(changes).length;

  // A field you can't see must not be saved: drop edits that become hidden.
  useEffect(() => {
    const stale = Object.keys(draft).filter((name) => {
      const field = spec.fields[name];
      return field && !isVisible(field, values);
    });
    if (stale.length) {
      setDraft((prev) => {
        const next = { ...prev };
        stale.forEach((name) => delete next[name]);
        return next;
      });
    }
  }, [draft, spec.fields, values]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming) setConfirming(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/config/${service}/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.to])),
          baseUpdatedAt: current.updated_at ?? null,
          note,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.rejected ? `${body.error} — ${body.rejected.join("; ")}` : body.error);
        if (res.status === 409 && body.current) {
          setCurrent(body.current);
          setDraft({});
        }
        return;
      }
      setCurrent(body.row);
      setDraft({});
      setConfirming(false);
      setNote("");
      onSaved(body.row);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const res = await fetch(`/api/audit?service=${service}&project=${encodeURIComponent(rowId)}&limit=50`);
    const body = await res.json();
    setHistory(res.ok ? body.entries : []);
    if (!res.ok) setError(body.error);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <aside className="fixed inset-0 z-50 flex flex-col bg-background shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[min(760px,100vw)] md:border-l md:border-border">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-safe md:px-5 md:py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{serviceLabel}</span>
              {String(current.project_code ?? rowId)}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Editing live Supabase config · last updated {formatSgt(current.updated_at)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => (history ? setHistory(null) : loadHistory())}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:border-primary md:py-1.5"
            >
              🕘 {history ? "Fields" : "History"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:border-primary md:py-1.5"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6 md:px-5">
          {history ? (
            <section className="pt-5">
              <h3 className="mb-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                Change history
              </h3>
              {history.length ? (
                history.map((entry) => (
                  <div
                    key={entry.id}
                    className={`mb-2 rounded-xl border p-3 text-xs ${
                      entry.external ? "border-warn/50" : "border-border"
                    }`}
                  >
                    <div className="text-[11px] text-muted-foreground">
                      {formatSgt(entry.at)} ·{" "}
                      {entry.external ? (
                        <b className="text-warn">⚠️ changed outside the dashboard</b>
                      ) : (
                        entry.actor_email
                      )}
                    </div>
                    {entry.note ? <div className="mt-1 text-warn">📝 {entry.note}</div> : null}
                    {Object.entries(entry.changes).map(([column, change]) => (
                      <div key={column} className="mt-1">
                        <code className="font-mono text-[11px]">{column}</code>{" "}
                        <span className="text-muted-foreground line-through">{display(change.from)}</span> →{" "}
                        <span className="font-semibold text-on">{display(change.to)}</span>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No changes recorded yet.</p>
              )}
            </section>
          ) : (
            spec.groups.map((group) => {
              const visible = group.fields.filter((name) => isVisible(spec.fields[name], values));
              if (!visible.length) return null;
              return (
                <section key={group.title} className="pt-5">
                  <h3 className="mb-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </h3>
                  {visible.map((name) => {
                    const field = spec.fields[name];
                    const changed = Boolean(changes[name]);
                    return (
                      <div
                        key={name}
                        className={`grid grid-cols-1 gap-1.5 rounded-lg px-2 py-2.5 md:grid-cols-[240px_1fr] md:items-start md:gap-4 md:py-2 ${
                          changed ? "bg-primary/15" : ""
                        }`}
                      >
                        <div className="md:pt-1.5">
                          <div className="text-sm font-medium">{field.label}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{name}</div>
                        </div>
                        <div>
                          <Control
                            field={field}
                            value={values[name]}
                            onChange={(next) => setDraft((prev) => ({ ...prev, [name]: next }))}
                          />
                          {field.help ? (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">{field.help}</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 pt-3 pb-safe md:px-5 md:py-3">
          <div className={`text-xs ${dirtyCount ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            {error ? <span className="text-danger">{error}</span> : dirtyCount
              ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`
              : "No changes"}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dirtyCount}
              onClick={() => setDraft({})}
              className="rounded-lg border border-border px-3 py-2.5 text-xs disabled:opacity-40 md:py-1.5"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={!dirtyCount}
              onClick={() => setConfirming(true)}
              className="rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-40 md:py-1.5"
            >
              Review &amp; save
            </button>
          </div>
        </footer>
      </aside>

      {confirming ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4">
          <div className="max-h-[85vh] w-[min(560px,92vw)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background p-4 shadow-soft md:max-h-[80vh] md:p-5">
            <h3 className="mb-3 text-base font-semibold">Apply to Supabase?</h3>
            <div className="mb-4 text-sm">
              {Object.entries(changes).map(([name, change]) => (
                <div key={name} className="mt-1.5">
                  <b>{change.label}</b> <code className="font-mono text-[11px]">{name}</code>
                  <br />
                  <span className="text-muted-foreground line-through">{display(change.from)}</span> →{" "}
                  <span className="font-semibold text-on">{display(change.to)}</span>
                </div>
              ))}
            </div>
            <input
              className="mb-4 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              placeholder="Optional note for the audit log (why?)"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-border px-3 py-2.5 text-sm md:py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={apply}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 md:py-1.5"
              >
                {busy ? "Applying…" : "Apply changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
