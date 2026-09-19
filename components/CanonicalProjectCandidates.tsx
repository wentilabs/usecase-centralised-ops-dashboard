"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  canonicalSheetHref,
  type CandidateConflict,
  type CanonicalProject,
  type CanonicalProjectCandidate,
  type CanonicalProjectDraft,
} from "@/lib/canonical-projects";
import { SERVICES, SERVICE_KEYS, type ServiceKey } from "@/lib/services";

/**
 * One box, worn by both the reading and the editing state of every cell.
 *
 * The two states used to be a bare `<span>` and a fixed-width `<input>`, which
 * meant entering edit mode changed both dimensions at once: the column jumped
 * to the input's width, and a wrapped address or URL collapsed from three lines
 * to one, so the row shrank under the pointer. Sharing the padding, the border
 * width and the wrapping rules means the box a value is read in is the box it
 * is edited in — the border is merely transparent until you edit.
 */
// `block` belongs here, not on one state: a textarea is inline-block by
// default, which reserves a few pixels of descender space below it, so the
// editing box sat 3px taller than the reading one on every row.
const CELL_BOX = "block w-full rounded-md border px-2 py-1 text-xs leading-relaxed whitespace-pre-wrap break-words";
const CELL_READ = `${CELL_BOX} cursor-default border-transparent bg-transparent focus:outline-none`;
const CELL_EDIT = `${CELL_BOX} border-border bg-background outline-none focus:border-primary`;
const cellClass = "px-2 py-2 align-top";

/** A cell whose sources disagree, marked so the count in Sources can be located. */
const CELL_CONFLICT = "border-warn/60 bg-warn/5";

/**
 * Human names for the fields a conflict can name, for the panel and the cells.
 * Keyed on the draft field rather than the column so it reads as the table's
 * own heading does.
 */
const FIELD_LABELS: Record<string, string> = {
  service_aliases: "Service project code",
  company: "Company",
  site_name: "Site",
  site_address: "Address",
  latitude: "Latitude",
  longitude: "Longitude",
  safety_workbook_id: "Safety sheet",
  manpower_workbook_id: "Manpower sheet",
  noise_workbook_id: "Noise sheet",
  wbgt_workbook_id: "WBGT sheet",
  send_message_url: "Send URL",
  reply_message_url: "Reply URL",
  send_document_url: "Document URL",
  whatsapp_instance_name: "WhatsApp instance",
  whatsapp_client_id: "WhatsApp client",
  timezone: "Timezone",
  public_holiday_region: "Holiday region",
  general_notes: "Notes",
};

/**
 * Every column's width, declared once.
 *
 * The table used automatic layout, which derives each column from its content —
 * and a textarea contributes its own intrinsic width rather than the text's, so
 * pressing Edit widened nineteen columns by about 52px each and moved the row
 * height with them. Measured before this: 67px tall and 19 columns shifted.
 * With `table-fixed` and these widths the browser never consults the content,
 * so a cell is the same box whether it is being read or typed into.
 *
 * The header is generated from this list too, so a width and its heading cannot
 * drift apart.
 */
const SERVICE_COLUMN_WIDTH = 112;
const FIXED_COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "primary", label: "Primary", width: 128 },
  { key: "alternate", label: "Alternate aliases", width: 160 },
];
const TRAILING_COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "company", label: "Company", width: 128 },
  { key: "site_name", label: "Site", width: 128 },
  { key: "site_address", label: "Address", width: 192 },
  { key: "latitude", label: "Lat", width: 96 },
  { key: "longitude", label: "Lng", width: 96 },
  { key: "safety_workbook_id", label: "Safety sheet", width: 176 },
  { key: "manpower_workbook_id", label: "Manpower sheet", width: 176 },
  { key: "noise_workbook_id", label: "Noise sheet", width: 176 },
  { key: "wbgt_workbook_id", label: "WBGT sheet", width: 176 },
  { key: "send_message_url", label: "Send URL", width: 208 },
  { key: "reply_message_url", label: "Reply URL", width: 208 },
  { key: "send_document_url", label: "Document URL", width: 208 },
  { key: "whatsapp_instance_name", label: "WA instance", width: 128 },
  { key: "whatsapp_client_id", label: "WA client", width: 128 },
  { key: "timezone", label: "Timezone", width: 112 },
  { key: "public_holiday_region", label: "Holiday", width: 112 },
  { key: "general_notes", label: "Notes", width: 192 },
  { key: "sources", label: "Sources", width: 160 },
  // Wide enough for "Cancel edit" beside "Add to projects" on one line: the
  // toggle is the only control here whose label changes, and at 208 it wrapped
  // the pair onto two rows the moment you pressed Edit.
  { key: "actions", label: "Actions", width: 248 },
];

function tableColumns() {
  return [
    ...FIXED_COLUMNS,
    ...SERVICE_KEYS.map((service) => ({
      key: service,
      label: SERVICES[service].shortLabel ?? SERVICES[service].label,
      width: SERVICE_COLUMN_WIDTH,
    })),
    ...TRAILING_COLUMNS,
  ];
}

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

/**
 * A textarea that grows to its content, so editing a long value shows all of it.
 *
 * A single-line input was the other half of the disorientation: an address or a
 * proxy URL is longer than any column here, so editing one meant scrolling a
 * 48-character window with no way to see which value you were in. Height is set
 * from scrollHeight on every change, which lands on the same height the reading
 * state had, because the text wraps at the same width in the same font.
 */
function AutoTextarea({ value, onChange, className, ...rest }: {
  value: string;
  onChange: (value: string) => void;
  className: string;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "className">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Refit on width too, not just on typing. Measuring once at mount read a
    // scrollHeight from before the fixed column width had settled, so a sheet
    // id wrapped into five lines and stayed there — the cell ended two lines
    // taller than the span it replaced.
    // Width only: fit() changes the height, so an unguarded observer on this
    // element would retrigger itself forever.
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      const width = node.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      fit(node);
    });
    observer.observe(node);
    fit(node);
    return () => observer.disconnect();
  }, [value]);

  function fit(node: HTMLTextAreaElement) {
    // Collapse first: scrollHeight only shrinks if the box is smaller than the
    // content, so measuring without this leaves a textarea that grows and never
    // returns when text is deleted.
    node.style.height = "auto";
    // scrollHeight covers content and padding but not the border, and
    // border-box counts the border inside the height we are setting — so
    // without this every textarea came out 2px shorter than the span it
    // replaced, and the row lost a couple of pixels per edit.
    const border = node.offsetHeight - node.clientHeight;
    node.style.height = `${node.scrollHeight + border}px`;
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${className} resize-none overflow-hidden`}
      {...rest}
    />
  );
}

/**
 * The same textarea whether the row is being read or edited.
 *
 * Matching a span's metrics to a textarea's was the wrong approach: they wrap
 * long values at different points and round their heights differently, so the
 * row kept moving by a line or two however carefully the padding, border and
 * line-height were aligned. One element cannot disagree with itself — reading
 * is just the read-only state of it, with the border turned transparent.
 */
function TextCell({ value, editing, onChange, conflict = false }: {
  value: string | null;
  editing: boolean;
  onChange: (value: string) => void;
  conflict?: boolean;
}) {
  return (
    <AutoTextarea
      value={editing ? value ?? "" : shown(value)}
      onChange={onChange}
      readOnly={!editing}
      // Not a tab stop while reading: a row of unreachable boxes would
      // otherwise sit between the keyboard and the buttons that do something.
      tabIndex={editing ? undefined : -1}
      className={`${editing ? CELL_EDIT : CELL_READ} ${conflict ? CELL_CONFLICT : ""}`}
    />
  );
}

function SheetCell({ value, editing, onChange, conflict = false }: {
  value: string | null;
  editing: boolean;
  onChange: (value: string) => void;
  conflict?: boolean;
}) {
  const href = canonicalSheetHref(value);
  return (
    // min-w-0: a grid track defaults to max-content, so a 44-character sheet
    // id pushed the reading state out to 334px inside a 176px column — it
    // overflowed the cell on one line while the textarea correctly wrapped to
    // three, which is where the last of the height jump came from.
    <div className="grid min-w-0 gap-1">
      <TextCell value={value} editing={editing} onChange={onChange} conflict={conflict} />
      {/* Kept in both states rather than only while reading: a link that
          disappears on Edit is one more thing moving when nothing should. */}
      {href ? <a href={href} target="_blank" rel="noreferrer" className="px-2 text-xs text-primary hover:underline">Open sheet ↗</a> : null}
    </div>
  );
}

function NumberCell({ value, editing, onChange, conflict = false }: {
  value: number | null;
  editing: boolean;
  onChange: (value: number | null) => void;
  conflict?: boolean;
}) {
  return (
    <input
      type={editing ? "number" : "text"}
      step="any"
      value={editing ? value ?? "" : shown(value)}
      readOnly={!editing}
      tabIndex={editing ? undefined : -1}
      onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      className={`${editing ? CELL_EDIT : CELL_READ} ${conflict ? CELL_CONFLICT : ""}`}
    />
  );
}

/**
 * What a conflict actually is, said in the table rather than in a title
 * attribute.
 *
 * A conflict is two services holding different non-blank values for the same
 * field, so HALO cannot tell which one describes the site — and it leaves the
 * field blank rather than guess. That is the part worth spelling out: the empty
 * cell is a question, not missing data. Each value is offered as a button while
 * editing, because choosing one is the whole job.
 */
function ConflictPanel({ conflicts, editing, onPick }: {
  conflicts: CandidateConflict[];
  editing: boolean;
  onPick: (conflict: CandidateConflict, value: string, source: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs">
      <p className="text-warn">
        {conflicts.length === 1 ? "One field is" : `${conflicts.length} fields are`} held differently by different
        services, so HALO left {conflicts.length === 1 ? "it" : "them"} blank rather than pick one.
        {editing ? " Choose the value that describes this site." : " Press Edit to choose a value."}
      </p>
      {conflicts.map((conflict, index) => (
        <div key={`${String(conflict.field)}-${index}`} className="grid gap-1">
          <div className="font-medium">{FIELD_LABELS[String(conflict.field)] ?? String(conflict.field)}</div>
          <div className="flex flex-wrap gap-2">
            {conflict.values.map((entry, position) => (
              <button
                key={`${entry.source}-${position}`}
                type="button"
                disabled={!editing}
                onClick={() => onPick(conflict, entry.value, entry.source)}
                className="max-w-full rounded-md border border-border bg-background px-2 py-1 text-left enabled:hover:border-primary disabled:cursor-default disabled:opacity-80"
              >
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{entry.source}</span>
                <span className="block break-words">{entry.value}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CandidateRow({ candidate, existing, canEdit, columnCount }: {
  candidate: CanonicalProjectCandidate;
  existing: CanonicalProject | null;
  canEdit: boolean;
  columnCount: number;
}) {
  const [draft, setDraft] = useState(() => cloneDraft(candidate.draft));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CanonicalProject | null>(existing);
  const [error, setError] = useState<string | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);

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

  /** Which fields disagree, so a cell can say so where the value would be. */
  const conflictedFields = new Set(candidate.conflicts.map((conflict) => String(conflict.field)));
  /** Service columns named by a service_aliases conflict, e.g. `wbgt.project_code`. */
  const conflictedServices = new Set(
    candidate.conflicts
      .filter((conflict) => conflict.field === "service_aliases")
      .flatMap((conflict) => conflict.values.map((entry) => entry.source.split(".")[0])),
  );

  function applyConflictValue(conflict: CandidateConflict, value: string, source: string) {
    if (conflict.field === "service_aliases") {
      setServiceAlias(source.split(".")[0] as ServiceKey, value);
      return;
    }
    if (conflict.field === "latitude" || conflict.field === "longitude") {
      setDraft((current) => ({ ...current, [conflict.field]: value === "" ? null : Number(value) }));
      return;
    }
    setText(conflict.field, value);
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

  return (
    <>
      <tr className={`border-b border-border/60 ${showConflicts ? "" : "last:border-0"}`}>
        <td className="sticky left-0 z-10 border-r border-border bg-card px-2 py-2 align-top">
          <AutoTextarea
            className={`${editing ? CELL_EDIT : CELL_READ} font-mono font-medium`}
            value={editing ? draft.primary_alias : shown(draft.primary_alias)}
            readOnly={!editing}
            tabIndex={editing ? undefined : -1}
            onChange={(value) => setDraft((current) => ({ ...current, primary_alias: value }))}
          />
        </td>
        <td className={cellClass}>
          <AutoTextarea
            className={editing ? CELL_EDIT : CELL_READ}
            value={editing ? draft.alternate_aliases.join(", ") : draft.alternate_aliases.join(", ") || "—"}
            readOnly={!editing}
            tabIndex={editing ? undefined : -1}
            onChange={(value) => setDraft((current) => ({ ...current, alternate_aliases: value.split(",").map((item) => item.trim()).filter(Boolean) }))}
          />
        </td>
        {SERVICE_KEYS.map((service) => (
          <td key={service} className={cellClass}>
            <TextCell value={draft.service_aliases[service] ?? null} editing={editing} onChange={(value) => setServiceAlias(service, value)} conflict={conflictedServices.has(service)} />
          </td>
        ))}
        <td className={cellClass}><TextCell value={draft.company} editing={editing} onChange={(value) => setText("company", value)} conflict={conflictedFields.has("company")} /></td>
        <td className={cellClass}><TextCell value={draft.site_name} editing={editing} onChange={(value) => setText("site_name", value)} conflict={conflictedFields.has("site_name")} /></td>
        <td className={cellClass}><TextCell value={draft.site_address} editing={editing} onChange={(value) => setText("site_address", value)} conflict={conflictedFields.has("site_address")} /></td>
        <td className={cellClass}><NumberCell value={draft.latitude} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, latitude: value }))} conflict={conflictedFields.has("latitude")} /></td>
        <td className={cellClass}><NumberCell value={draft.longitude} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, longitude: value }))} conflict={conflictedFields.has("longitude")} /></td>
        <td className={cellClass}><SheetCell value={draft.safety_workbook_id} editing={editing} onChange={(value) => setText("safety_workbook_id", value)} conflict={conflictedFields.has("safety_workbook_id")} /></td>
        <td className={cellClass}><SheetCell value={draft.manpower_workbook_id} editing={editing} onChange={(value) => setText("manpower_workbook_id", value)} conflict={conflictedFields.has("manpower_workbook_id")} /></td>
        <td className={cellClass}><SheetCell value={draft.noise_workbook_id} editing={editing} onChange={(value) => setText("noise_workbook_id", value)} conflict={conflictedFields.has("noise_workbook_id")} /></td>
        <td className={cellClass}><SheetCell value={draft.wbgt_workbook_id} editing={editing} onChange={(value) => setText("wbgt_workbook_id", value)} conflict={conflictedFields.has("wbgt_workbook_id")} /></td>
        <td className={cellClass}><TextCell value={draft.send_message_url} editing={editing} onChange={(value) => setText("send_message_url", value)} conflict={conflictedFields.has("send_message_url")} /></td>
        <td className={cellClass}><TextCell value={draft.reply_message_url} editing={editing} onChange={(value) => setText("reply_message_url", value)} conflict={conflictedFields.has("reply_message_url")} /></td>
        <td className={cellClass}><TextCell value={draft.send_document_url} editing={editing} onChange={(value) => setText("send_document_url", value)} conflict={conflictedFields.has("send_document_url")} /></td>
        <td className={cellClass}><TextCell value={draft.whatsapp_instance_name} editing={editing} onChange={(value) => setText("whatsapp_instance_name", value)} conflict={conflictedFields.has("whatsapp_instance_name")} /></td>
        <td className={cellClass}><TextCell value={draft.whatsapp_client_id} editing={editing} onChange={(value) => setText("whatsapp_client_id", value)} conflict={conflictedFields.has("whatsapp_client_id")} /></td>
        <td className={cellClass}><TextCell value={draft.timezone} editing={editing} onChange={(value) => setText("timezone", value)} conflict={conflictedFields.has("timezone")} /></td>
        <td className={cellClass}><TextCell value={draft.public_holiday_region} editing={editing} onChange={(value) => setText("public_holiday_region", value)} conflict={conflictedFields.has("public_holiday_region")} /></td>
        <td className={cellClass}><TextCell value={draft.general_notes} editing={editing} onChange={(value) => setText("general_notes", value)} conflict={conflictedFields.has("general_notes")} /></td>
        <td className={cellClass}>
          {candidate.conflicts.length ? (
            // A button, not a tooltip: the values behind this count are the
            // reason the fields beside it are empty, and a title attribute
            // cannot be reached on a touch screen or read at leisure.
            <button
              type="button"
              onClick={() => setShowConflicts((current) => !current)}
              className="rounded-md border border-warn/50 px-2 py-1 text-left text-warn hover:border-warn"
              aria-expanded={showConflicts}
            >
              {candidate.conflicts.length} conflict{candidate.conflicts.length === 1 ? "" : "s"} {showConflicts ? "▴" : "▾"}
            </button>
          ) : candidate.cluster.tier === "suggested" ? <span className="text-warn">Suggested identity</span> : <span className="text-on">Sources agree</span>}
        </td>
        <td className="sticky right-0 z-10 border-l border-border bg-card px-2 py-2 align-top text-right">
          {created ? <Link href={`/projects/${encodeURIComponent(created.id)}`} className="text-sm text-primary hover:underline">Saved · Open project →</Link> : canEdit ? (
            <div className="grid justify-items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => editing ? (setDraft(cloneDraft(candidate.draft)), setEditing(false), setError(null)) : (setEditing(true), candidate.conflicts.length ? setShowConflicts(true) : null)} className="w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50">{editing ? "Cancel edit" : "Edit"}</button>
                <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving ? "Adding…" : "Add to projects"}</button>
              </div>
              {error ? <p className="max-w-64 text-left text-xs text-danger">{error}</p> : null}
            </div>
          ) : <span className="text-xs text-muted-foreground">Read only</span>}
        </td>
      </tr>
      {showConflicts && candidate.conflicts.length ? (
        <tr className="border-b border-border/60 last:border-0">
          <td colSpan={columnCount} className="px-2 pb-3">
            <ConflictPanel conflicts={candidate.conflicts} editing={editing} onPick={applyConflictValue} />
          </td>
        </tr>
      ) : null}
    </>
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
  const columns = tableColumns();
  const columnCount = columns.length;
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

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
        <table className="table-fixed text-left text-xs" style={{ width: totalWidth }}>
          {/* Widths live here, not on the cells: with table-fixed the browser
              sizes from this and never measures the content, which is what
              keeps a column identical in reading and editing states. */}
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  className={
                    index === 0
                      ? "sticky left-0 z-20 border-r border-border bg-card px-2 py-2"
                      : column.key === "actions"
                        ? "sticky right-0 z-20 border-l border-border bg-card px-2 py-2 text-right"
                        : "px-2 py-2"
                  }
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => <CandidateRow key={candidate.key} candidate={candidate} existing={existingProjectFor(candidate, existingProjects)} canEdit={canEdit && sourceComplete} columnCount={columnCount} />)}
            {!candidates.length ? <tr><td colSpan={columnCount} className="p-8 text-center text-muted-foreground">No service projects were available to reconstruct.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
