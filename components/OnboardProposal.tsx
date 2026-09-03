"use client";

import { useMemo, useState } from "react";

import { useBodyScrollLock, useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * Review and create the projects one sentence asked for.
 *
 * The sibling of BatchProposal, and deliberately not the same component: that
 * one edits rows that exist, with a per-row `updated_at` to check against and a
 * diff to show. A create has no before-state, can be refused for a field nobody
 * supplied, and is far harder to undo — a wrong edit is corrected, a wrong row
 * is a project someone has to find and delete.
 *
 * So it keeps the three properties that make the bulk edit safe, and adds one:
 *
 * - **Nothing is created until it is read.** Every row is listed by code.
 * - **Each row is its own POST** through the ordinary onboarding endpoint, so
 *   it keeps that route's validation and its own failure.
 * - **A row can be dropped** without rewording the request.
 * - **Blocked rows are shown, never hidden.** "34 of 36 need a Safety workbook
 *   id" is the answer to the request. Creating only the two that happen to be
 *   complete would answer a question nobody asked.
 */

export type OnboardRowView = {
  projectCode: string;
  values: Record<string, string>;
  /** What this site is already called elsewhere, so a code can be recognised. */
  knownAs: string[];
  problems?: string[];
};

export type OnboardServiceView = {
  service: string;
  label: string;
  ready: OnboardRowView[];
  blocked: OnboardRowView[];
  alreadyThere: { projectCode: string; existingAs: string }[];
};

export type OnboardPlanView = {
  summary: string;
  company: string | null;
  services: OnboardServiceView[];
};

type Outcome = { key: string; ok: boolean; error?: string };

export function OnboardProposal({
  plan,
  onClose,
  onApplied,
}: {
  plan: OnboardPlanView;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Outcome[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [showBlocked, setShowBlocked] = useState(true);

  useEscapeKey(!busy, onClose);
  useBodyScrollLock(true);

  const keyFor = (service: string, code: string) => `${service}:${code}`;

  const chosen = useMemo(
    () =>
      plan.services.flatMap((entry) =>
        entry.ready
          .filter((row) => !skipped.has(keyFor(entry.service, row.projectCode)))
          .map((row) => ({ service: entry.service, label: entry.label, row })),
      ),
    [plan, skipped],
  );

  const totals = useMemo(() => {
    const ready = plan.services.reduce((sum, entry) => sum + entry.ready.length, 0);
    const blocked = plan.services.reduce((sum, entry) => sum + entry.blocked.length, 0);
    const already = plan.services.reduce((sum, entry) => sum + entry.alreadyThere.length, 0);
    return { ready, blocked, already };
  }, [plan]);

  async function apply() {
    setBusy(true);
    const outcomes: Outcome[] = [];
    // One at a time, not in parallel: thirty concurrent creates would make the
    // failure report a race, and a partial failure here has to be legible.
    for (const [index, entry] of chosen.entries()) {
      setProgress(index);
      const key = keyFor(entry.service, entry.row.projectCode);
      try {
        const response = await fetch(`/api/onboard/${entry.service}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: entry.row.values }),
        });
        const body = await response.json().catch(() => ({}));
        outcomes.push({
          key,
          ok: response.ok,
          ...(response.ok ? {} : { error: body?.error ?? `HTTP ${response.status}` }),
        });
      } catch (error) {
        outcomes.push({ key, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    setDone(outcomes);
    setBusy(false);
    // Refresh regardless of failures: the rows that were created exist, and
    // leaving the cards stale would hide them.
    onApplied();
  }

  const failures = done?.filter((outcome) => !outcome.ok) ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-background md:max-h-[85vh] md:w-[min(760px,94vw)] md:rounded-2xl">
        <header className="shrink-0 border-b border-border px-4 pb-3 pt-safe md:pt-4">
          <h3 className="text-base font-semibold">
            {done ? "Onboarding done" : "Create these projects?"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{plan.summary}</p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              <span className="font-semibold text-on">{chosen.length}</span> will be created
            </span>
            {totals.blocked ? (
              <span>
                <span className="font-semibold text-warn">{totals.blocked}</span> blocked
              </span>
            ) : null}
            {totals.already ? (
              <span>
                <span className="font-semibold text-foreground">{totals.already}</span> already there
              </span>
            ) : null}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {plan.services.map((entry) => (
            <section key={entry.service} className="mb-4 last:mb-0">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {entry.label}
              </h4>

              {entry.ready.length ? (
                <ul className="space-y-1.5">
                  {entry.ready.map((row) => {
                    const key = keyFor(entry.service, row.projectCode);
                    const outcome = done?.find((item) => item.key === key);
                    const off = skipped.has(key);
                    return (
                      <li
                        key={key}
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
                                  if (event.target.checked) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                              aria-label={`Create ${row.projectCode} in ${entry.label}`}
                              className="h-4 w-4 shrink-0"
                            />
                          ) : (
                            <span className="w-4 shrink-0 text-center">
                              {outcome ? (outcome.ok ? "✓" : "✕") : "·"}
                            </span>
                          )}
                          <span className="font-mono font-semibold">{row.projectCode}</span>
                          {row.knownAs.length ? (
                            <span className="truncate text-[11px] text-muted-foreground">
                              already {row.knownAs.join(" · ")}
                            </span>
                          ) : null}
                        </div>
                        {outcome?.error ? (
                          <div className="mt-1 pl-6 text-[11px] text-danger">{outcome.error}</div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing here can be created as it stands.</p>
              )}

              {entry.blocked.length ? (
                <div className="mt-2 rounded-xl border border-warn/40 bg-warn/5 p-2.5">
                  <button
                    type="button"
                    onClick={() => setShowBlocked((open) => !open)}
                    className="flex w-full items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-wider text-warn"
                  >
                    <span aria-hidden>{showBlocked ? "▾" : "▸"}</span>
                    {entry.blocked.length} cannot be created yet
                  </button>
                  {showBlocked ? (
                    <ul className="mt-1.5 space-y-1">
                      {entry.blocked.map((row) => (
                        <li key={row.projectCode} className="text-xs">
                          <span className="font-mono">{row.projectCode}</span>{" "}
                          <span className="text-muted-foreground">— {row.problems?.join(" ")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    These need a value nothing in the estate can supply. Fill it in through Add project,
                    or set it on the row afterwards.
                  </p>
                </div>
              ) : null}

              {entry.alreadyThere.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {entry.alreadyThere.length} site
                  {entry.alreadyThere.length === 1 ? " is" : "s are"} already onboarded here
                  {entry.alreadyThere.some((item) => item.existingAs !== item.projectCode)
                    ? `, including ${entry.alreadyThere
                        .filter((item) => item.existingAs !== item.projectCode)
                        .slice(0, 3)
                        .map((item) => `${item.projectCode} as ${item.existingAs}`)
                        .join(", ")}`
                    : ""}
                  .
                </p>
              ) : null}
            </section>
          ))}
        </div>

        <footer className="shrink-0 border-t border-border px-4 pt-3 pb-safe md:pb-4">
          {done ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs">
                {done.filter((outcome) => outcome.ok).length} created
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
                  Creating {progress + 1} of {chosen.length}…
                </span>
              ) : (
                <span className="mr-auto text-[11px] text-muted-foreground">
                  Each project is created disabled, through the same route as Add project.
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
                {busy ? "Creating…" : `Create ${chosen.length}`}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
