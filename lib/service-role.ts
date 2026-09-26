import type { CanonicalProject } from "./canonical-projects";
import type { ProjectConfigRow, ServiceKey } from "./services";

/** What the live rows say about this service's place in the project. */
export type ServiceRoleStatus =
  | "Enabled"
  | "Disabled"
  | "Not onboarded"
  | "Alias not found"
  | "Ambiguous alias"
  | "Could not read";

export type ServiceRole = {
  service: ServiceKey;
  /** The explicit override, or null. Not the code that was searched for. */
  alias: string | null;
  row: ProjectConfigRow | null;
  status: ServiceRoleStatus;
  error?: string;
};

/**
 * The code this service's row is expected to carry.
 *
 * A per-service alias is an OVERRIDE, not a requirement — the canonical editor
 * says so in as many words: "Blank means this service uses the primary alias;
 * enter a value only when its live project code differs." This is where that
 * sentence is honoured.
 *
 * It did not used to be. A blank alias meant no lookup at all, so a service
 * whose row existed, was enabled and was delivering messages still read as
 * "Not onboarded". CCCC hit exactly that: haze and lightning were onboarded
 * from the project page, both rows were written with `project_code = 'CCCC'`,
 * and both cards reported the service absent because `service_aliases` carried
 * only wbgt and noise.
 *
 * Onboarding does try to attach the alias, so a blank one is not supposed to
 * survive — but `attachCanonicalServiceAlias` runs AFTER the insert and reports
 * a warning rather than failing, deliberately, so that a registry hiccup never
 * costs you the service row. Treating the registry as the only evidence a row
 * exists quietly undid that: the row survived and became invisible instead.
 */
export function expectedCodeFor(service: ServiceKey, project: CanonicalProject): string {
  return (project.service_aliases[service] ?? "").trim() || String(project.primary_alias ?? "").trim();
}

/**
 * One service's role in a project, from the rows that service actually holds.
 *
 * `rows` is that one service's table, already read; this function decides only
 * which row belongs to this project and what to call the result.
 */
export function serviceRoleFor(
  service: ServiceKey,
  project: CanonicalProject,
  rows: ProjectConfigRow[],
  error?: string,
): ServiceRole {
  const alias = project.service_aliases[service] ?? null;
  const expected = expectedCodeFor(service, project);
  const matching = expected
    ? rows.filter((row) => String(row.project_code ?? "").trim() === expected)
    : [];

  const status: ServiceRoleStatus = error
    ? "Could not read"
    : matching.length > 1
      ? "Ambiguous alias"
      : matching.length === 1
        ? matching[0].enabled === true
          ? "Enabled"
          : "Disabled"
        : // Nothing matched. Which "no row" state this is depends on whether
          // anyone ever claimed a code: an explicit alias pointing at nothing is
          // a broken link worth naming, while a blank one is simply a service
          // this project does not run yet.
          alias
          ? "Alias not found"
          : "Not onboarded";

  return { service, alias, row: matching.length === 1 ? matching[0] : null, status, error };
}
