"use client";

import { useEffect, useMemo, useState } from "react";

import { useBackdropDismiss } from "@/lib/backdrop-dismiss";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { ProjectConfigRow } from "@/lib/services";
import { MentionTargetsEditor } from "./MentionTargetsEditor";

export function MentionTargetsDialog({
  row,
  rowId,
  onClose,
  onSaved,
}: {
  row: ProjectConfigRow;
  rowId: string;
  onClose: () => void;
  onSaved: (row: ProjectConfigRow) => void;
}) {
  const [current, setCurrent] = useState(row);
  const [draft, setDraft] = useState<unknown>(row.mention_targets ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock(true);

  const changed = useMemo(
    () => JSON.stringify(draft ?? null) !== JSON.stringify(current.mention_targets ?? null),
    [current.mention_targets, draft],
  );
  const dismiss = useBackdropDismiss(!busy, onClose);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/config/ailytics/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: { mention_targets: draft },
          baseUpdatedAt: current.updated_at ?? null,
          note: note.trim() || "Updated mention targets",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error
          ? `${body.error}${body.rejected?.length ? ` — ${body.rejected.join("; ")}` : ""}`
          : `Could not save mention targets (status ${response.status}).`);
        if (response.status === 409 && body.current) {
          setCurrent(body.current);
          setDraft(body.current.mention_targets ?? null);
        }
        return;
      }
      setCurrent(body.row);
      setDraft(body.row.mention_targets ?? null);
      onSaved(body.row);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="pt-safe-dialog fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/85 p-3 backdrop-blur-sm md:p-6"
      {...dismiss}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mention-targets-title"
        className="w-full max-w-7xl rounded-2xl border border-border bg-card shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 md:px-6">
          <div>
            <h2 id="mention-targets-title" className="text-base font-semibold text-foreground">
              {String(current.project_code ?? rowId)} — Mention targets
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configure contacts and time windows for this Ailytics project.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-4 py-4 md:px-6">
          {error ? (
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <MentionTargetsEditor value={draft} onChange={setDraft} />
          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="text-xs text-muted-foreground">
              Change note for history <span className="opacity-70">(optional)</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                placeholder="Updated mention targets"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!changed || busy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save mention targets"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
