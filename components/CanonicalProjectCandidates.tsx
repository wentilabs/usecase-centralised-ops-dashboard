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

const inputClass = "w-48 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary";
const compactInputClass = "w-28 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary";
const cellClass = "max-w-52 px-2 py-2 align-top";

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
    : <span className="block max-w-52 whitespace-normal break-words" title={value ?? undefined}>{shown(value)}</span>;
}

function SheetCell({ value, editing, onChange }: { value: string | null; editing: boolean; onChange: (value: string) => void }) {
  const href = canonicalSheetHref(value);
  return (
    <div className="grid gap-1">
      {editing ? <input className={inputClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /> : <span className="block max-w-48 break-all">{shown(value)}</span>}
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
      <td className="sticky left-0 z-10 min-w-32 border-r border-border bg-card px-2 py-2 align-top">
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
      <td className={cellClass}><SheetCell value={draft.noise_workbook_id} editing={editing} onChange={(value) => setText("noise_workbook_id", value)} /></td>
      <td className={cellClass}><SheetCell value={draft.wbgt_workbook_id} editing={editing} onChange={(value) => setText("wbgt_workbook_id", value)} /></td>
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
      <td className="sticky right-0 z-10 min-w-52 border-l border-border bg-card px-2 py-2 align-top text-right">
        {created ? <Link href={`/projects/${encodeURIComponent(created.id)}`} className="text-sm text-primary hover:underline">Saved · Open project →</Link> : canEdit ? (
          <div className="grid justify-items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => editing ? (setDraft(cloneDraft(candidate.draft)), setEditing(false), setError(null)) : setEditing(true)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50">{editing ? "Cancel edit" : "Edit"}</button>
              <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving ? "Adding…" : "Add to projects"}</button>
            </div>
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Rebuild canonical projects</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Review the reconstructed fields in a compact table. Edit a row only when it needs correction, then add it to the canonical projects registry.</p>
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
        <table className="min-w-max text-left text-xs">
          <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-20 min-w-32 border-r border-border bg-card px-2 py-2">Primary</th>
              <th className="min-w-40 px-2 py-2">Alternate aliases</th>
              {SERVICE_KEYS.map((service) => <th key={service} className="min-w-28 px-2 py-2">{SERVICES[service].shortLabel ?? SERVICES[service].label}</th>)}
              <th className="min-w-32 px-2 py-2">Company</th><th className="min-w-32 px-2 py-2">Site</th><th className="min-w-48 px-2 py-2">Address</th>
              <th className="min-w-24 px-2 py-2">Lat</th><th className="min-w-24 px-2 py-2">Lng</th>
              <th className="min-w-44 px-2 py-2">Safety sheet</th><th className="min-w-44 px-2 py-2">Manpower sheet</th><th className="min-w-44 px-2 py-2">Noise sheet</th><th className="min-w-44 px-2 py-2">WBGT sheet</th>
              <th className="min-w-52 px-2 py-2">Send URL</th><th className="min-w-52 px-2 py-2">Reply URL</th><th className="min-w-52 px-2 py-2">Document URL</th>
              <th className="min-w-32 px-2 py-2">WA instance</th><th className="min-w-32 px-2 py-2">WA client</th>
              <th className="min-w-28 px-2 py-2">Timezone</th><th className="min-w-28 px-2 py-2">Holiday</th><th className="min-w-48 px-2 py-2">Notes</th>
              <th className="min-w-28 px-2 py-2">Sources</th>
              <th className="sticky right-0 z-20 min-w-52 border-l border-border bg-card px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => <CandidateRow key={candidate.key} candidate={candidate} existing={existingProjectFor(candidate, existingProjects)} canEdit={canEdit && sourceComplete} />)}
            {!candidates.length ? <tr><td colSpan={SERVICE_KEYS.length + 22} className="p-8 text-center text-muted-foreground">No service projects were available to reconstruct.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
