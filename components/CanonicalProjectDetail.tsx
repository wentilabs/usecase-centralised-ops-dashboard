import { ServiceRoleCard, type ServiceRoleStatus } from "./ServiceRoleCard";
import { CanonicalProjectEditor } from "./CanonicalProjectEditor";
import { canonicalSheetHref, type CanonicalProject, type CanonicalProjectDraft } from "@/lib/canonical-projects";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";

function asDraft(project: CanonicalProject): CanonicalProjectDraft {
  const { id: _id, created_at: _created, updated_at: _updated, ...draft } = project;
  return draft;
}

const sheetFields = [
  ["Safety workbook", "safety_workbook_id"],
  ["Manpower workbook", "manpower_workbook_id"],
  ["Noise analysis sheet", "noise_workbook_id"],
  ["WBGT monthly sheet", "wbgt_workbook_id"],
] as const;

export function CanonicalProjectDetail({
  project,
  rows,
  errors,
  canEdit,
}: {
  project: CanonicalProject;
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  errors: Partial<Record<ServiceKey, string>>;
  canEdit: boolean;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 md:px-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{project.primary_alias}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Canonical identity and approved common resources. Service configuration remains service-owned.</p>
        </div>
        <a href="/projects" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">← Projects</a>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Live service roles</h2>
        <p className="mt-1 text-sm text-muted-foreground">Current rows from the live service tables; these indicators do not change service behavior.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_KEYS.map((service) => {
            const alias = project.service_aliases[service];
            const matching = alias ? (rows[service] ?? []).filter((row) => String(row.project_code ?? "").trim() === alias) : [];
            const status: ServiceRoleStatus = errors[service]
              ? "Could not read"
              : !alias
                ? "Not onboarded"
                : matching.length === 0
                  ? "Alias not found"
                  : matching.length > 1
                    ? "Ambiguous alias"
                    : matching[0].enabled === true
                      ? "Enabled"
                      : "Disabled";
            return (
              <ServiceRoleCard
                key={service}
                service={service}
                project={project}
                rows={rows[service] ?? []}
                alias={alias ?? null}
                status={status}
                error={errors[service]}
                canEdit={canEdit}
              />
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <h2 className="font-semibold">Sheets</h2>
        <p className="mt-1 text-sm text-muted-foreground">Quick links to the workbooks recorded for this project.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {sheetFields.map(([label, field]) => {
            const href = canonicalSheetHref(project[field]);
            return <div key={field} className="rounded-lg border border-border/70 bg-background px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p>{href ? <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-primary hover:underline">Open sheet ↗</a> : <p className="mt-1 text-sm text-muted-foreground">Not recorded</p>}</div>;
          })}
        </div>
      </section>

      <CanonicalProjectEditor initial={asDraft(project)} project={project} canEdit={canEdit} compact hideHeader />
    </main>
  );
}
