"use client";

import { useState } from "react";
import Link from "next/link";

import {
  canonicalSheetHref,
  type CanonicalProject,
  type CanonicalProjectCandidate,
  type CanonicalProjectDraft,
} from "@/lib/canonical-projects";
import { SERVICES, SERVICE_KEYS, type ServiceKey } from "@/lib/services";

const inputClass = "w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary";
const compactInputClass = "w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary";
const cellClass = "max-w-72 px-3 py-2 align-top";

function cloneDraft(draft: CanonicalProjectDraft): CanonicalProjectDraft {
  return { ...draft, alternate_aliases: [...draft.alternate_aliases], service_aliases: { ...draft.service_aliases } };
}

function shown(value: string | number | null | undefined) {
  return String(value ?? "").trim() || "—";
}

function existingProjectFor(candidate: CanonicalProjectCandidate, projects: CanonicalProject[]) {
  const primary = candidate.draft.primary_alias.trim().toLowerCase();
  return projects.find((project) => {
    if (project.primary_alias.trim().toLowerCase() === primary) return true;
    return SERVICE_KEYS.some((service) => {
      const candidateAlias = candidate.draft.service_aliases[service];
      return Boolean(candidateAlias && project.service_aliases[service] === candidateAlias);
    });
  }) ?? null;
}

function TextCell({ value, editing, onChange, compact = false }: { value: string | null; editing: boolean; onChange: (value: string) => void; compact?: boolean }) {
  return editing
    ? <input className={compact ? compactInputClass : inputClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    : <span className="block max-w-72 whitespace-normal break-words" title={value ?? undefined}>{shown(value)}</span>;
}

function SheetCell({ value, editing, onChange }: { value: string | null; editing: boolean; onChange: (value: string) => void }) {
  const href = canonicalSheetHref(value);
  return (
    <div className="grid gap-1">
      {editing ? <input className={inputClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /> : <span className="block max-w-64 break-all">{shown(value)}</span>}
      {href ? <a href={href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open sheet ↗</a> : null}
    </div>
  );
}

function CandidateRow({ candidate, existing, canEdit }: { candidate: CanonicalProjectCandidate; existing: CanonicalProject | null; canEdit: boolean }) {
  const [draft, setDraft] = useState(() => cloneDraft(candidate.draft));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CanonicalProject | null>(existing);
  const [error, setError] = useState<string | null>(null);

  function setText(field: keyof CanonicalProjectDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value || null }));
  }

  function setServiceAlias(service: ServiceKey, value: string) {
    setDraft((current) => {
      const serviceAliases = { ...current.service_aliases };
      if (value) serviceAliases[service] = value;
      else delete serviceAliases[service];
      return { ...current, service_aliases: serviceAliases };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/canonical-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; problems?: string[]; project?: CanonicalProject };
      if (!response.ok || !body.project) {
        const details = body.problems?.length ? ` ${body.problems.join(" ")}` : "";
        throw new Error(`${body.error ?? `HTTP ${response.status}`}${details}`);
      }
      setCreated(body.project);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const conflictSummary = candidate.conflicts
    .map((conflict) => `${String(conflict.field)}: ${conflict.values.map((entry) => `${entry.source} = ${entry.value}`).join("; ")}`)
    .join("\n");

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="sticky left-0 z-10 min-w-44 border-r border-border bg-card px-3 py-2 align-top">
        {editing ? <input className={compactInputClass} value={draft.primary_alias} onChange={(event) => setDraft((current) => ({ ...current, primary_alias: event.target.value }))} /> : <span className="font-mono font-medium">{shown(draft.primary_alias)}</span>}
      </td>
      <td className={cellClass}>{editing ? <input className={inputClass} value={draft.alternate_aliases.join(", ")} onChange={(event) => setDraft((current) => ({ ...current, alternate_aliases: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} /> : <span>{draft.alternate_aliases.join(", ") || "—"}</span>}</td>
      {SERVICE_KEYS.map((service) => <td key={service} className={cellClass}><TextCell compact value={draft.service_aliases[service] ?? null} editing={editing} onChange={(value) => setServiceAlias(service, value)} /></td>)}
      <td className={cellClass}><TextCell value={draft.company} editing={editing} onChange={(value) => setText("company", value)} /></td>
      <td className={cellClass}><TextCell value={draft.site_name} editing={editing} onChange={(value) => setText("site_name", value)} /></td>
      <td className={cellClass}><TextCell value={draft.site_address} editing={editing} onChange={(value) => setText("site_address", value)} /></td>
      <td className={cellClass}>{editing ? <input type="number" step="any" className={compactInputClass} value={draft.latitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value === "" ? null : Number(event.target.value) }))} /> : shown(draft.latitude)}</td>
      <td className={cellClass}>{editing ? <input type="number" step="any" className={compactInputClass} value={draft.longitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value === "" ? null : Number(event.target.value) }))} /> : shown(draft.longitude)}</td>
      <td className={cellClass}><SheetCell value={draft.safety_workbook_id} editing={editing} onChange={(value) => setText("safety_workbook_id", value)} /></td>
      <td className={cellClass}><SheetCell value={draft.manpower_workbook_id} editing={editing} onChange={(value) => setText("manpower_workbook_id", value)} /></td>
      <td className={cellClass}><TextCell value={draft.send_message_url} editing={editing} onChange={(value) => setText("send_message_url", value)} /></td>
      <td className={cellClass}><TextCell value={draft.reply_message_url} editing={editing} onChange={(value) => setText("reply_message_url", value)} /></td>
      <td className={cellClass}><TextCell value={draft.send_document_url} editing={editing} onChange={(value) => setText("send_document_url", value)} /></td>
      <td className={cellClass}><TextCell value={draft.whatsapp_instance_name} editing={editing} onChange={(value) => setText("whatsapp_instance_name", value)} /></td>
      <td className={cellClass}><TextCell value={draft.whatsapp_client_id} editing={editing} onChange={(value) => setText("whatsapp_client_id", value)} /></td>
      <td className={cellClass}><TextCell compact value={draft.timezone} editing={editing} onChange={(value) => setText("timezone", value)} /></td>
      <td className={cellClass}><TextCell compact value={draft.public_holiday_region} editing={editing} onChange={(value) => setText("public_holiday_region", value)} /></td>
      <td className={cellClass}><TextCell value={draft.general_notes} editing={editing} onChange={(value) => setText("general_notes", value)} /></td>
      <td className={`${cellClass} min-w-40`}>
        {candidate.conflicts.length ? <span className="text-warn" title={conflictSummary}>{candidate.conflicts.length} conflict{candidate.conflicts.length === 1 ? "" : "s"}</span> : candidate.cluster.tier === "suggested" ? <span className="text-warn">Suggested identity</span> : <span className="text-on">Sources agree</span>}
      </td>
      <td className="sticky right-0 z-10 min-w-44 border-l border-border bg-card px-3 py-2 align-top text-right">
        {created ? <Link href={`/projects/${encodeURIComponent(created.id)}`} className="text-sm text-primary hover:underline">Saved · Open project →</Link> : canEdit ? (
          <div className="grid justify-items-end gap-2">
            {editing ? (
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => { setDraft(cloneDraft(candidate.draft)); setEditing(false); setError(null); }} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50">Cancel</button>
                <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Save project"}</button>
              </div>
            ) : <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:border-primary">Edit</button>}
            {error ? <p className="max-w-64 text-left text-xs text-danger">{error}</p> : null}
          </div>
        ) : <span className="text-xs text-muted-foreground">Read only</span>}
      </td>
    </tr>
  );
}

/** Inline, review-first importer. Nothing is written until one row's Save project action. */
export function CanonicalProjectCandidates({ candidates, existingProjects, canEdit, unavailableServices = [] }: {
  candidates: CanonicalProjectCandidate[];
  existingProjects: CanonicalProject[];
  canEdit: boolean;
  /** Sources omitted from this read; candidates must not be treated as complete. */
  unavailableServices?: string[];
}) {
  const sourceComplete = unavailableServices.length === 0;

  return (
    <main className="flex w-full flex-col gap-4 px-3 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Rebuild canonical projects</h1>
          <p className="mt-1 max-w-4xl text-sm text-muted-foreground">Every reconstructed field is shown below. Edit only the row that needs correction, then save it directly; unchanged suggestions can be saved as-is.</p>
        </div>
        <a href="/projects" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">← Projects</a>
      </div>

      {!sourceComplete ? (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          <p className="font-medium">This reconstruction is incomplete, so saving is disabled.</p>
          <p className="mt-1">HALO could not read: {unavailableServices.map((service) => SERVICES[service as keyof typeof SERVICES].label).join(", ")}. Resolve those source reads and reload first.</p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-max text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-20 min-w-44 border-r border-border bg-card px-3 py-3">Primary alias</th>
              <th className="min-w-56 px-3 py-3">Alternate aliases</th>
              {SERVICE_KEYS.map((service) => <th key={service} className="min-w-36 px-3 py-3">{SERVICES[service].shortLabel ?? SERVICES[service].label} alias</th>)}
              <th className="min-w-48 px-3 py-3">Company</th><th className="min-w-48 px-3 py-3">Site name</th><th className="min-w-64 px-3 py-3">Site address</th>
              <th className="min-w-36 px-3 py-3">Latitude</th><th className="min-w-36 px-3 py-3">Longitude</th>
              <th className="min-w-64 px-3 py-3">Safety workbook</th><th className="min-w-64 px-3 py-3">Manpower workbook</th>
              <th className="min-w-72 px-3 py-3">Send-message URL</th><th className="min-w-72 px-3 py-3">Reply-message URL</th><th className="min-w-72 px-3 py-3">Send-document URL</th>
              <th className="min-w-48 px-3 py-3">WhatsApp instance</th><th className="min-w-48 px-3 py-3">WhatsApp client ID</th>
              <th className="min-w-40 px-3 py-3">Timezone</th><th className="min-w-40 px-3 py-3">Holiday region</th><th className="min-w-64 px-3 py-3">General notes</th>
              <th className="min-w-40 px-3 py-3">Source review</th>
              <th className="sticky right-0 z-20 min-w-44 border-l border-border bg-card px-3 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => <CandidateRow key={candidate.key} candidate={candidate} existing={existingProjectFor(candidate, existingProjects)} canEdit={canEdit && sourceComplete} />)}
            {!candidates.length ? <tr><td colSpan={SERVICE_KEYS.length + 20} className="p-8 text-center text-muted-foreground">No service projects were available to reconstruct.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
