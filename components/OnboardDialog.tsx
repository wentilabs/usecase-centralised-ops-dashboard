"use client";

import { useEffect, useMemo, useState } from "react";

import { resolveValue, validateDraft, type OnboardDefinition, type OnboardDraft } from "@/lib/onboarding";
import type { ProjectConfigRow } from "@/lib/services";
import { useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * Create a project row.
 *
 * Two things this form does that the editor does not need to:
 *
 * - **Shows what a blank field will actually become.** Three URLs come from server
 *   env vars the browser cannot read, and two tab names are derived from the
 *   project code. Leaving them empty is the normal case, so the placeholder says
 *   what will be stored rather than nothing.
 * - **Lists the steps HALO cannot do.** Sharing the sheet and deploying the
 *   forwarding adapter are not row writes, and a row created without them looks
 *   finished while doing nothing.
 */
export function OnboardDialog({
  definition,
  rows,
  onClose,
  onCreated,
}: {
  definition: OnboardDefinition;
  rows: ProjectConfigRow[];
  onClose: () => void;
  onCreated: (projectCode: string) => void;
}) {
  const [draft, setDraft] = useState<OnboardDraft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  /** Which env-backed defaults the server actually has. */
  const [envReady, setEnvReady] = useState<Record<string, boolean> | null>(null);
  const [missingEnv, setMissingEnv] = useState<string[]>([]);

  useEscapeKey(!busy, onClose);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/onboard/${definition.service}`);
        const body = await res.json();
        if (cancelled) return;
        setEnvReady(body.defaultsResolved ?? {});
        setMissingEnv(body.missingEnvDefaults ?? []);
      } catch {
        if (!cancelled) setEnvReady({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [definition.service]);

  const code = String(draft.project_code ?? "").trim();
  /**
   * A stand-in for the server's env: the value is never sent to the browser, only
   * whether it resolved. Without this the client would report a required field as
   * missing while the server would have filled it, and the button would stay
   * disabled with a message contradicting the placeholder beside it.
   */
  const envStub = useMemo(() => {
    const stub: Record<string, string> = {};
    for (const entry of definition.fields) {
      if (entry.envDefault && envReady?.[entry.column]) stub[entry.envDefault] = "set";
    }
    return stub;
  }, [definition, envReady]);
  const problems = useMemo(
    () => validateDraft(definition, draft, rows, envStub),
    [definition, draft, rows, envStub],
  );
  const touched = Object.values(draft).some((value) => String(value ?? "").trim());
  const canRun = problems.length === 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/onboard/${definition.service}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setCreated(String(body.row?.project_code ?? code));
      onCreated(String(body.row?.project_code ?? code));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";

  /** What the column will hold if this input stays empty. */
  function placeholderFor(entry: OnboardDefinition["fields"][number]): string {
    if (entry.envDefault) {
      if (envReady === null) return "checking server default…";
      return envReady[entry.column]
        ? `from ${entry.envDefault}`
        : `${entry.envDefault} is not set on the server`;
    }
    const resolved = resolveValue(entry, {}, code, {});
    if (resolved) return resolved;
    return entry.notNull ? "left blank (stored as empty)" : "left blank";
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-background p-4 shadow-2xl md:max-h-[88vh] md:w-[min(680px,94vw)] md:rounded-2xl md:p-5">
        <h3 className="text-base font-semibold">{definition.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>

        {created ? (
          <div className="mt-4 rounded-lg border border-on/40 bg-on/10 p-3">
            <div className="text-sm font-semibold text-on">{created} created, disabled</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              It will not process anything until you set <code className="font-mono">enabled</code> in its editor.
              Finish the two steps below first.
            </p>
            <ul className="mt-2 list-inside list-disc text-[11px] text-muted-foreground">
              {definition.outsideHalo.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {missingEnv.length ? (
              <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] text-warn">
                Not set on the server: <span className="font-mono">{missingEnv.join(", ")}</span>. Those
                fields have no default, so type them in or the insert will be refused.
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              {definition.fields.map((entry) => (
                <div key={entry.column} className="grid grid-cols-1 gap-1 md:grid-cols-[200px_1fr] md:items-start md:gap-3">
                  <div className="md:pt-2">
                    <div className="text-sm font-medium">
                      {entry.label}
                      {entry.required ? <span className="ml-1 text-danger">*</span> : null}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">{entry.column}</div>
                  </div>
                  <div>
                    <input
                      className={field}
                      value={draft[entry.column] ?? ""}
                      disabled={busy}
                      placeholder={placeholderFor(entry)}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [entry.column]: event.target.value }))
                      }
                    />
                    {entry.help ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{entry.help}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-border bg-card/50 p-3">
              <div className="text-[11px] font-semibold">HALO cannot do these — they are not row writes</div>
              <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
                {definition.outsideHalo.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              The row is always created with <code className="font-mono">enabled = false</code>. Enable it
              from the project&apos;s editor once you have validated it.
            </p>

            {problems.length && touched ? (
              <ul className="mt-3 list-inside list-disc text-[11px] text-warn">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        {error ? (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[11px] text-danger">{error}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2 pb-safe">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2.5 text-sm disabled:opacity-50 md:py-1.5"
          >
            {created ? "Done" : "Cancel"}
          </button>
          {created ? null : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canRun}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 md:py-1.5"
            >
              {busy ? "Creating…" : "Create disabled row"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
