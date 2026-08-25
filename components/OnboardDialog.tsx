"use client";

import { useEffect, useMemo, useState } from "react";

import { GroupPicker } from "./GroupPicker";
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
  groupNames = {},
  onClose,
  onCreated,
}: {
  definition: OnboardDefinition;
  rows: ProjectConfigRow[];
  /** Chat id to human group name, so the picker shows names rather than ids. */
  groupNames?: Record<string, string>;
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
  /** A prerequisite database function, and whether it is installed. */
  const [rpc, setRpc] = useState<{ fn: string; describes: string; installed: boolean | null } | null>(null);
  const [steps, setSteps] = useState<{ step: string; detail: string }[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  /** Fields a human has edited. Autofill stops touching these. */
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [lookup, setLookup] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [candidates, setCandidates] = useState<
    { index: number; address: string; postal_code: string | null; latitude: number; longitude: number; valid: boolean }[]
  >([]);
  const [lookupError, setLookupError] = useState<string | null>(null);

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
        // Prefill rather than hint: the row is about to carry these values, so
        // show them. Anything already typed wins.
        if (body.prefill) {
          setDraft((prev) => ({ ...(body.prefill as Record<string, string>), ...prev }));
        }
        setRpc(body.rpc ?? null);
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
  /**
   * Values the service would derive, recomputed on every keystroke. Applied only
   * to fields nobody has edited, so a deliberate override always survives.
   */
  const derived = useMemo(() => {
    const out: Record<string, { value: string; note: string; review: boolean }> = {};
    for (const entry of definition.fields) {
      if (!entry.autofill) continue;
      const result = entry.autofill(draft);
      if (result) out[entry.column] = result;
    }
    return out;
  }, [definition, draft]);

  useEffect(() => {
    const pending = Object.entries(derived).filter(
      ([column, result]) => !edited.has(column) && draft[column] !== result.value,
    );
    if (!pending.length) return;
    setDraft((prev) => {
      const next = { ...prev };
      for (const [column, result] of pending) next[column] = result.value;
      return next;
    });
  }, [derived, edited, draft]);

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
      setSteps(body.steps ?? []);
      setWarning(body.warning ?? null);
      setCreated(String(body.row?.project_code ?? code));
      onCreated(String(body.row?.project_code ?? code));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const wantsCoordinates = definition.fields.some((entry) => entry.column === "latitude");

  async function runLookup() {
    setLookingUp(true);
    setLookupError(null);
    setCandidates([]);
    try {
      const res = await fetch(`/api/onboard/geocode?q=${encodeURIComponent(lookup)}`);
      const body = await res.json();
      if (!res.ok) {
        setLookupError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (!body.results?.length) setLookupError(`OneMap returned nothing for "${lookup}".`);
      setCandidates(body.results ?? []);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLookingUp(false);
    }
  }

  /** Taking a candidate counts as filling the coordinates in, not as editing
   *  the region — so the derived region still follows. */
  function useCandidate(candidate: (typeof candidates)[number]) {
    setEdited((prev) => {
      const next = new Set(prev);
      next.add("latitude");
      next.add("longitude");
      next.add("site_address");
      return next;
    });
    setDraft((prev) => ({
      ...prev,
      latitude: String(candidate.latitude),
      longitude: String(candidate.longitude),
      site_address: candidate.address ?? prev.site_address ?? "",
    }));
    setCandidates([]);
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
            {steps.length ? (
              <ul className="mt-2 flex flex-col gap-0.5 text-[11px]">
                {steps.map((entry) => (
                  <li key={entry.step}>
                    <span className="text-on">✓</span> {entry.step}{" "}
                    <span className="font-mono text-[10px] text-muted-foreground">{entry.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {warning ? (
              <p className="mt-2 rounded border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">{warning}</p>
            ) : null}
            <div className="mt-2 text-[11px] font-semibold">Still to do</div>
            <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
              {definition.outsideHalo.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {rpc && rpc.installed === false ? (
              <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[11px] text-danger">
                <span className="font-mono">{rpc.fn}</span> is not installed on the database, so HALO cannot
                create {rpc.describes}. Run <span className="font-mono">supabase/migrate_onboarding_rpc.sql</span>{" "}
                in the service repo first.
              </p>
            ) : null}

            {missingEnv.length ? (
              <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] text-warn">
                Not set on the server: <span className="font-mono">{missingEnv.join(", ")}</span>. Those
                fields have no default, so type them in or the insert will be refused.
              </p>
            ) : null}

            {wantsCoordinates ? (
              <div className="mt-4 rounded-lg border border-border bg-card/40 p-3">
                <div className="text-[11px] font-semibold">Find the coordinates</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Postal code or address, looked up through OneMap. Or type the coordinates below directly.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    className={field}
                    value={lookup}
                    disabled={busy || lookingUp}
                    placeholder="e.g. 068914, or V on Shenton"
                    onChange={(event) => setLookup(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && lookup.trim()) {
                        event.preventDefault();
                        void runLookup();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void runLookup()}
                    disabled={!lookup.trim() || busy || lookingUp}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"
                  >
                    {lookingUp ? "Searching…" : "Search"}
                  </button>
                </div>
                {lookupError ? <p className="mt-2 text-[11px] text-warn">{lookupError}</p> : null}
                {candidates.length ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {candidates.map((candidate) => (
                      <li key={candidate.index}>
                        <button
                          type="button"
                          onClick={() => useCandidate(candidate)}
                          disabled={!candidate.valid}
                          className="w-full rounded border border-border px-2 py-1.5 text-left text-[11px] hover:border-primary disabled:opacity-40"
                        >
                          <span className="text-foreground">{candidate.address}</span>
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            {candidate.latitude}, {candidate.longitude}
                          </span>
                          {candidate.valid ? null : (
                            <span className="ml-2 text-warn">outside the service area</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              {definition.fields.map((entry) => (
                <div key={entry.column} className="grid grid-cols-1 gap-1 md:grid-cols-[200px_1fr] md:items-start md:gap-3">
                  <div className="md:pt-2">
                    <div className="text-sm font-medium">
                      {entry.label}
                      {entry.required && !entry.computed ? <span className="ml-1 text-danger">*</span> : null}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">{entry.column}</div>
                  </div>
                  <div>
                    {entry.computed ? (
                      // Derived from the project code and created on demand as a
                      // sheet tab, so an editable box would invite a mismatch.
                      <div className="rounded-lg border border-dashed border-border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
                        {code ? (
                          <span className="text-foreground">{resolveValue(entry, {}, code, {})}</span>
                        ) : (
                          "set from the project code"
                        )}
                        <span className="ml-2 text-[10px] uppercase tracking-wider">automatic</span>
                      </div>
                    ) : entry.kind === "groups" ? (
                      // The same picker the editor uses: a chat id says nothing,
                      // and picking the wrong group is the kind of mistake nobody
                      // notices until a site gets someone else's messages.
                      <GroupPicker
                        value={draft[entry.column] ?? ""}
                        groupNames={groupNames}
                        disabled={busy}
                        onChange={(next) => {
                          setEdited((prev) => new Set(prev).add(entry.column));
                          setDraft((prev) => ({ ...prev, [entry.column]: next }));
                        }}
                      />
                    ) : (
                      <input
                        className={field}
                        value={draft[entry.column] ?? ""}
                        disabled={busy}
                        placeholder={placeholderFor(entry)}
                        onChange={(event) => {
                          setEdited((prev) => new Set(prev).add(entry.column));
                          setDraft((prev) => ({ ...prev, [entry.column]: event.target.value }));
                        }}
                      />
                    )}
                    {derived[entry.column] && !edited.has(entry.column) ? (
                      <p
                        className={`mt-1 text-[11px] ${derived[entry.column].review ? "text-warn" : "text-muted-foreground"}`}
                      >
                        {derived[entry.column].review ? "Derived — confirm before enabling. " : ""}
                        {derived[entry.column].note}
                      </p>
                    ) : entry.help ? (
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
