import type { ProjectConfigRow, ServiceKey } from "../services";
import { pillsFor } from "./pills";

/** Links derivable from the row itself. */
/**
 * Everything the search box should match a card on.
 *
 * Project code and company are the obvious ones. The interesting addition is the
 * card's own pills: typing "water parade" should surface the projects that
 * actually have it, which is the question someone is really asking when they
 * reach for the filter.
 *
 * **Only pills that are ON contribute.** A struck-through pill means the
 * capability is absent, so matching it would return exactly the projects the
 * searcher does not want. That is the whole distinction, and it is why this uses
 * `pillsFor` rather than a static list of known labels.
 *
 * Labels keep their emoji here and are lowercased; a substring match still works
 * because "water parade" is inside "💧 water parade".
 */
export function searchTokens(service: ServiceKey, config: ProjectConfigRow): string[] {
  return [
    String(config.project_code ?? ""),
    String(config.company ?? ""),
    ...pillsFor(service, config)
      .filter((pill) => pill.on)
      .map((pill) => pill.label),
  ]
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether a card matches a free-text query. An empty query matches everything. */
export function matchesQuery(service: ServiceKey, config: ProjectConfigRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return searchTokens(service, config).some((token) => token.includes(needle));
}
