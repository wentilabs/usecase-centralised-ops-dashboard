import { CanonicalProjectEditor } from "./CanonicalProjectEditor";
import type { CanonicalProject, CanonicalProjectDraft } from "@/lib/canonical-projects";
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
}: {
  project: CanonicalProject;
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  errors: Partial<Record<ServiceKey, string>>;
  canEdit: boolean;
}) {
  return (
    <>
      <CanonicalProjectEditor initial={asDraft(project)} project={project} canEdit={canEdit} />
      <section className="mx-auto mb-8 w-full max-w-5xl px-3 md:px-5">
        <h2 className="text-lg font-semibold">Live service rows</h2>
        <p className="mt-1 text-sm text-muted-foreground">Read from the existing service tables. These indicators do not change any service behavior.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_KEYS.map((service) => {
            const alias = project.service_aliases[service];
            const matching = alias ? (rows[service] ?? []).filter((row) => String(row.project_code ?? "").trim() === alias) : [];
            const status = errors[service]
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
              <article key={service} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2"><h3 className="font-medium">{SERVICES[service].label}</h3><span className={status === "Enabled" ? "text-on" : status.includes("not") || status.includes("Could") || status.includes("Ambiguous") ? "text-warn" : "text-muted-foreground"}>{status}</span></div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{alias ?? "No service alias recorded"}</p>
                {errors[service] ? <p className="mt-2 text-xs text-danger">{errors[service]}</p> : null}
                {alias ? <a href={`/?service=${encodeURIComponent(service)}`} className="mt-3 inline-block text-xs text-primary hover:underline">Open service configuration →</a> : null}
                {!alias && canEdit ? <a href={`/?onboard=${encodeURIComponent(service)}&project=${encodeURIComponent(project.id)}`} className="mt-3 inline-block text-xs text-primary hover:underline">Add this service →</a> : null}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
