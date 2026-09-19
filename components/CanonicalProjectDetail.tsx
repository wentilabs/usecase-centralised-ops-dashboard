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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{project.primary_alias}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Canonical identity and approved common resources. Service configuration remains service-owned.</p>
        </div>
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
