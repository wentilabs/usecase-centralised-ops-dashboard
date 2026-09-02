/**
 * The human layer over `project-identity`.
 *
 * Derivation gets most of the estate right, and cannot get all of it right:
 * `CFC` and `Clifford Centre` are one site that shares no chat id, no sheet and
 * no name fragment with each other. No rule reaches that. It has to be written
 * down, and this is where.
 *
 * Both lists are deliberately code-level rather than row-level, so they survive
 * a project being onboarded into another service later.
 *
 * Entries here beat every derived signal, so a wrong merge is always correctable
 * — that is the property that makes it safe to let anything act on this map.
 */

/** Codes that ARE the same site, where the evidence does not show it. */
export const MERGES: { codes: string[]; note: string }[] = [
  // Seeded empty on purpose. Nothing should be merged by assertion until
  // someone who knows the sites has confirmed it — see the review report.
];

/** Pairs that must never be merged, however similar they look. */
export const SPLITS: [string, string][] = [
  // e.g. ["TBC", "TBCA"] if those turn out to be different sites.
];
