import { ProjectServiceBoard } from "./ProjectServiceBoard";
import { CanonicalProjectEditor } from "./CanonicalProjectEditor";
import { canonicalSheetHref, type CanonicalProject, type CanonicalProjectDraft } from "@/lib/canonical-projects";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";

function asDraft(project: CanonicalProject): CanonicalProjectDraft {
  const { id: _id, created_at: _created, updated_at: _updated, ...draft } = project;
  return draft;
}


export function CanonicalProjectDetail({
  project,
  rows,
  errors,
  canEdit,
  visoUrl = null,
}: {
  project: CanonicalProject;
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  errors: Partial<Record<ServiceKey, string>>;
  canEdit: boolean;
  /** Viso base URL, so delivery chips on the cards link to the mirrored thread. */
  visoUrl?: string | null;
}) {
  // Wider: the role cards want three or four abreast and the editor is a
  // two-column grid, both of which a 5xl column was squeezing.
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 md:px-5">
      {/* Code, company, address — the three things that identify a site, on one
          line, with a rule under it. The sentence that used to sit here
          explained what a canonical project is, which is worth saying once on
          the registry and not on every project you open. */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <h1 className="flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold">
          <span>{project.primary_alias}</span>
          {[project.company, project.site_address ?? project.site_name]
            .filter(Boolean)
            .map((part) => (
              <span key={String(part)} className="text-lg font-normal text-muted-foreground">
                <span aria-hidden="true" className="mr-2">·</span>
                {part}
              </span>
            ))}
        </h1>
        <a href="/projects" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">← Projects</a>
      </header>

      {/* The dashboard's own cards, and the Sheets strip is gone with them:
          every workbook it listed is already a link on the card of the service
          that owns it, where it sits beside the schedule and delivery that
          explain what the workbook is for. */}
      <ProjectServiceBoard
        project={project}
        rows={rows}
        errors={errors}
        canEdit={canEdit}
        visoUrl={visoUrl}
      />

      <CanonicalProjectEditor initial={asDraft(project)} project={project} canEdit={canEdit} compact hideHeader />
    </main>
  );
}
