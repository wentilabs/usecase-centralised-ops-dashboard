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

/**
 * Codes that ARE the same site, where the evidence does not show it.
 *
 * `canonical` pins the spelling the site is filed under, for the cases where
 * the derived tie-break picks the wrong one.
 */
export const MERGES: { codes: string[]; note: string; canonical?: string }[] = [
  // Ruled on 2 Sep 2026 from the alias review. Each of these was linked by
  // reading the names only — a shared prefix, or `CFC` as an abbreviation of
  // `Clifford Centre` — which is never enough to merge on its own. Signed off,
  // they are now facts, and every one of them stops a duplicate row being
  // created the next time something onboards in bulk.
  { codes: ["C991", "C991-SGB"], note: "reviewed 2 Sep 2026: same site" },
  { codes: ["C992", "C992-SYT"], note: "reviewed 2 Sep 2026: same site" },
  { codes: ["CFC", "Clifford Centre"], note: "reviewed 2 Sep 2026: same site" },
  { codes: ["TBC", "TBCA"], note: "reviewed 2 Sep 2026: same site" },
];

/** Pairs that must never be merged, however similar they look. */
export const SPLITS: [string, string][] = [
  // Nothing kept apart. `TBS` is worth watching: it neither merges with `TBC`
  // nor is split from it, because no rule links them — if that ever changes,
  // this is where it gets refused.
];
