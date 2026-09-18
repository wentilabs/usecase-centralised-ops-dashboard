"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { CanonicalProject, CanonicalProjectDraft, CandidateConflict } from "@/lib/canonical-projects";
import { SERVICES, SERVICE_KEYS, type ServiceKey } from "@/lib/services";

type Editable = CanonicalProjectDraft;

function cloneDraft(draft: CanonicalProjectDraft): Editable {
  return { ...draft, alternate_aliases: [...draft.alternate_aliases], service_aliases: { ...draft.service_aliases } };
}

function text(value: string | null) {
  return value ?? "";
}

/**
 * One review-first editor for canonical identity and common resources. It never
 * talks to a service configuration route, so saving here cannot alter alerts.
 */
export function CanonicalProjectEditor({
  initial,
  project,
  canEdit,
  conflicts = [],
}: {
  initial: CanonicalProjectDraft;
  project?: CanonicalProject;
  canEdit: boolean;
  conflicts?: CandidateConflict[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Editable>(() => cloneDraft(initial));
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const input = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60";

  const setText = (field: Exclude<keyof Editable, "alternate_aliases" | "service_aliases" | "latitude" | "longitude">, value: string) =>
    setDraft((current) => ({ ...current, [field]: value || null }));

  async function save() {
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const endpoint = project ? `/api/canonical-projects/${encodeURIComponent(project.id)}` : "/api/canonical-projects";
      const response = await fetch(endpoint, {
        method: project ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, baseUpdatedAt: project?.updated_at ?? null }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; problems?: string[]; project?: CanonicalProject };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        setProblems(body.problems ?? []);
        return;
      }
      if (body.project) router.push(`/projects/${encodeURIComponent(body.project.id)}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-3 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{project ? draft.primary_alias || "Canonical project" : "Create canonical project"}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            This record stores approved site identity and common resources only. Saving it never changes any service configuration.
          </p>
        </div>
        <a href="/projects" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">
          ← Projects
        </a>
      </div>

      {conflicts.length ? (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <p className="font-medium text-warn">Values needing your decision</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/90">
            {conflicts.map((conflict, index) => (
              <li key={`${String(conflict.field)}-${index}`}>
                <span className="font-mono">{String(conflict.field)}</span>: {conflict.values.map((value) => `${value.source} = ${value.value}`).join(" · ")}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Conflicting values were intentionally left blank in the form below.</p>
        </div>
      ) : null}

      <fieldset disabled={!canEdit || busy} className="grid gap-5">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Project details</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Primary alias
              <input className={input} value={draft.primary_alias} onChange={(event) => setDraft((current) => ({ ...current, primary_alias: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Alternate aliases <span className="text-xs text-muted-foreground">comma-separated</span>
              <input className={input} value={draft.alternate_aliases.join(", ")} onChange={(event) => setDraft((current) => ({ ...current, alternate_aliases: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
            </label>
            <label className="grid gap-1 text-sm">Company<input className={input} value={text(draft.company)} onChange={(event) => setText("company", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Site name<input className={input} value={text(draft.site_name)} onChange={(event) => setText("site_name", event.target.value)} /></label>
            <label className="grid gap-1 text-sm md:col-span-2">Site address<input className={input} value={text(draft.site_address)} onChange={(event) => setText("site_address", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Latitude<input type="number" step="any" className={input} value={draft.latitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
            <label className="grid gap-1 text-sm">Longitude<input type="number" step="any" className={input} value={draft.longitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
            <label className="grid gap-1 text-sm">Timezone<input className={input} value={text(draft.timezone)} onChange={(event) => setText("timezone", event.target.value)} placeholder="Asia/Singapore" /></label>
            <label className="grid gap-1 text-sm">Public-holiday region<input className={input} value={text(draft.public_holiday_region)} onChange={(event) => setText("public_holiday_region", event.target.value)} placeholder="SG" /></label>
            <label className="grid gap-1 text-sm md:col-span-2">General notes<textarea className={`${input} min-h-24`} value={text(draft.general_notes)} onChange={(event) => setText("general_notes", event.target.value)} /></label>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Common resources</h2>
          <p className="mt-1 text-sm text-muted-foreground">These are suggestions for future onboarding, never automatic synchronization.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">Safety workbook ID<input className={input} value={text(draft.safety_workbook_id)} onChange={(event) => setText("safety_workbook_id", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Manpower workbook ID<input className={input} value={text(draft.manpower_workbook_id)} onChange={(event) => setText("manpower_workbook_id", event.target.value)} /></label>
            <label className="grid gap-1 text-sm md:col-span-2">Send-message URL<input className={input} value={text(draft.send_message_url)} onChange={(event) => setText("send_message_url", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Reply-message URL<input className={input} value={text(draft.reply_message_url)} onChange={(event) => setText("reply_message_url", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Send-document URL<input className={input} value={text(draft.send_document_url)} onChange={(event) => setText("send_document_url", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">WhatsApp instance name<input className={input} value={text(draft.whatsapp_instance_name)} onChange={(event) => setText("whatsapp_instance_name", event.target.value)} /></label>
            <label className="grid gap-1 text-sm">WhatsApp client ID<input className={input} value={text(draft.whatsapp_client_id)} onChange={(event) => setText("whatsapp_client_id", event.target.value)} /></label>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Per-service aliases</h2>
          <p className="mt-1 text-sm text-muted-foreground">The exact project code each live service uses. Blank means this registry does not claim the project is onboarded there.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {SERVICE_KEYS.map((service) => (
              <label key={service} className="grid gap-1 text-sm">
                {SERVICES[service].label}
                <input className={input} value={draft.service_aliases[service] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, service_aliases: { ...current.service_aliases, [service]: event.target.value || undefined } }))} />
              </label>
            ))}
          </div>
        </section>
      </fieldset>

      {!canEdit ? <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">Your account has read-only access.</p> : null}
      {error ? <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}
      {problems.length ? <ul className="list-disc rounded-lg border border-danger/40 bg-danger/10 p-3 pl-8 text-sm text-danger">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}

      {canEdit ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
          {reviewing ? <span className="mr-auto text-sm text-muted-foreground">Review the fields above. Applying saves only this canonical registry record.</span> : null}
          <button type="button" onClick={() => setReviewing((current) => !current)} disabled={!changed || busy} className="rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-50">{reviewing ? "Back to editing" : "Review changes"}</button>
          {reviewing ? <button type="button" onClick={() => void save()} disabled={busy} className="rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : project ? "Apply registry changes" : "Create canonical project"}</button> : null}
        </div>
      ) : null}
    </section>
  );
}
