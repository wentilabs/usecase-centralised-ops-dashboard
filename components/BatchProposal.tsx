"use client";

import { useMemo, useState } from "react";

import { groupDelta } from "@/lib/card-summary";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";
import { useBodyScrollLock, useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * Review and apply one chat request that covers several projects.
 *
 * The single-project path ends in the ordinary editor, where the diff and the
 * save button are the ones an operator already trusts. A bulk change cannot
 * reuse that — the editor holds one row, with one `baseUpdatedAt` and one audit
 * note — so this is the equivalent surface for many rows, and it keeps the same
 * three properties:
 *
 * - **Nothing is written until it is read.** Every row that will change is
 *   listed with its own diff. The list is the writes, not a count to be trusted.
 * - **Each row is still its own PATCH**, through the same endpoint the editor
 *   uses. So each keeps its own validation, its own optimistic-concurrency check
 *   against its own `updated_at`, and its own audit row carrying the sentence
 *   that caused it. There is no bulk write endpoint to secure separately.
 * - **A row can be dropped.** Fuzzy matching casts a wide net by design, so the
 *   operator must be able to say "not that one" without rewording.
 *
 * Applied one at a time rather than in parallel: thirty concurrent PATCHes would
 * make the failure report a race, and a partial failure here has to be legible
 * — which rows changed, which did not, and why.
 */

export type BatchEdit = {
  service: string;
  serviceLabel: string;
  projectCode: string;
  rowId: string;
  changes: Record<string, unknown>;
  detail?: string;
};

export type Batch = {
  scope: string;
  inScope: number;
  summary: string;
  matchedGroups?: { chatId: string; name: string; score: number }[];
  edits: BatchEdit[];
};

type Outcome = { rowId: string; ok: boolean; error?: string };

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function BatchProposal({
  batch,
  note,
  rowFor,
  groupNames,
  onClose,
  onApplied,
}: {
  batch: Batch;
  /** The sentence that caused this, written into every row's audit note. */
  note: string;
  /** The live row, for its `updated_at` and its before-values. */
  rowFor: (service: string, projectCode: string) => ProjectConfigRow | undefined;
  groupNames: Record<string, string>;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Outcome[] | null>(null);
  const [progress, setProgress] = useState(0);

  useEscapeKey(!busy, onClose);
  useBodyScrollLock(true);

  const key = (edit: BatchEdit) => `${edit.service}:${edit.rowId}`;
  const chosen = useMemo(
    () => batch.edits.filter((edit) => !skipped.has(key(edit))),
    [batch.edits, skipped],
  );

  async function apply() {
    setBusy(true);
    const outcomes: Outcome[] = [];
    for (const [index, edit] of chosen.entries()) {
      setProgress(index);
      const row = rowFor(edit.service, edit.projectCode);
      try {
        const response = await fetch(
          `/api/config/${edit.service}/${encodeURIComponent(edit.rowId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              changes: edit.changes,
              // Per row, so a project someone else edited while this list was
              // open comes back 409 instead of being overwritten.
              baseUpdatedAt: row?.updated_at ?? null,
              note,
            }),
          },
        );
        const body = await response.json().catch(() => ({}));
        outcomes.push({
          rowId: key(edit),
          ok: response.ok,
          ...(response.ok ? {} : { error: body?.error ?? `HTTP ${response.status}` }),
        });
      } catch (error) {
        outcomes.push({
          rowId: key(edit),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    setDone(outcomes);
    setBusy(false);
    // Refresh regardless of failures: the rows that did change have changed, and
    // leaving the cards stale would hide that.
    onApplied();
  }

  const failures = done?.filter((outcome) => !outcome.ok) ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-background md:max-h-[85vh] md:w-[min(720px,94vw)] md:rounded-2xl">
        <header className="shrink-0 border-b border-border px-4 pb-3 pt-safe md:pt-4">
          <h3 className="text-base font-semibold">
            {done ? "Applied" : "Apply to several projects?"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{batch.summary}</p>
          {/* Two different numbers, said separately on purpose. A scope of 29
              with 1 edit is the normal case — the other 28 already read that
              way — and collapsing them to "1 of 1" hides what was examined. */}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Scope: <span className="font-medium text-foreground">{batch.scope}</span>
            {batch.inScope > batch.edits.length ? (
              <>
                {" "}
                · {batch.inScope - batch.edits.length} already read that way
              </>
            ) : null}
          </p>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {chosen.length} project{chosen.length === 1 ? "" : "s"}
            </span>{" "}
            will be written{chosen.length < batch.edits.length ? `, ${batch.edits.length - chosen.length} skipped` : ""}.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {/* Matched groups first: with fuzzy matching, "which groups did it
              think I meant" is the question to answer before "which projects". */}
          {batch.matchedGroups?.length ? (
            <section className="mb-3 rounded-xl border border-warn/40 bg-warn/5 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-warn">
                Matched {batch.matchedGroups.length} group
                {batch.matchedGroups.length === 1 ? "" : "s"} by name
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs">
                {batch.matchedGroups.map((match) => (
                  <li key={match.chatId} className="flex items-baseline justify-between gap-2">
                    <span className="truncate" title={match.chatId}>
                      {match.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {match.score === 1 ? "exact" : `${Math.round(match.score * 100)}%`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                If one of these is not what you meant, close this and name the group more precisely —
                the match is what decides which ids come out.
              </p>
            </section>
          ) : null}

          <ul className="space-y-1.5">
            {batch.edits.map((edit) => {
              const id = key(edit);
              const outcome = done?.find((entry) => entry.rowId === id);
              const off = skipped.has(id);
              const row = rowFor(edit.service, edit.projectCode);
              return (
                <li
                  key={id}
                  className={`rounded-xl border p-2.5 text-xs ${
                    outcome
                      ? outcome.ok
                        ? "border-on/40 bg-on/5"
                        : "border-danger/50 bg-danger/5"
                      : off
                        ? "border-border opacity-50"
                        : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {!done ? (
                      <input
                        type="checkbox"
                        checked={!off}
                        disabled={busy}
                        onChange={(event) =>
                          setSkipped((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        aria-label={`Include ${edit.projectCode}`}
                        className="h-4 w-4 shrink-0"
                      />
                    ) : (
                      <span className="w-4 shrink-0 text-center">
                        {outcome ? (outcome.ok ? "✓" : "✕") : "·"}
                      </span>
                    )}
                    <span className="font-semibold">{edit.projectCode}</span>
                    <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px]">
                      {edit.serviceLabel}
                    </span>
                    {edit.detail ? (
                      <span className="truncate text-[11px] text-muted-foreground">{edit.detail}</span>
                    ) : null}
                  </div>

                  <div className="mt-1 pl-6">
                    {Object.entries(edit.changes).map(([column, to]) => {
                      const from = (row as Record<string, unknown> | undefined)?.[column] ?? null;
                      // Group columns read as names, the same way the single-row
                      // confirmation shows them — a chat id tells the reviewer
                      // nothing about whether this is the right change.
                      const delta = /group|wa_group|chat/.test(column)
                        ? groupDelta(from, to, groupNames)
                        : null;
                      return (
                        <div key={column} className="mt-0.5">
                          <code className="font-mono text-[10px] text-muted-foreground">{column}</code>{" "}
                          {delta ? (
                            <span>
                              {delta
                                .filter((entry) => entry.state !== "kept")
                                .map((entry) => (
                                  <span
                                    key={entry.chatId}
                                    className={
                                      entry.state === "removed"
                                        ? "mr-2 text-danger line-through"
                                        : "mr-2 font-semibold text-on"
                                    }
                                  >
                                    {entry.state === "removed" ? "−" : "+"} {entry.name}
                                  </span>
                                ))}
                            </span>
                          ) : (
                            <span>
                              <span className="text-muted-foreground line-through">{display(from)}</span>{" "}
                              → <span className="font-semibold text-on">{display(to)}</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {outcome?.error ? (
                      <div className="mt-1 text-[11px] text-danger">{outcome.error}</div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="shrink-0 border-t border-border px-4 pt-3 pb-safe md:pb-4">
          {done ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs">
                {done.filter((outcome) => outcome.ok).length} applied
                {failures.length ? (
                  <span className="text-danger">, {failures.length} failed — see above</span>
                ) : null}
                .
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-2.5 text-sm md:py-1.5"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {busy ? (
                <span className="mr-auto text-xs text-muted-foreground">
                  Applying {progress + 1} of {chosen.length}…
                </span>
              ) : (
                <span className="mr-auto text-[11px] text-muted-foreground">
                  Each project is saved separately, with this sentence in its audit note.
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-2.5 text-sm disabled:opacity-50 md:py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !chosen.length}
                onClick={apply}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 md:py-1.5"
              >
                {busy ? "Applying…" : `Apply to ${chosen.length}`}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
