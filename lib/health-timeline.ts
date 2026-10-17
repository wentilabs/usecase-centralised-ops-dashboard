import type { HealthColour } from "./health-status";

/**
 * One project's last N processes, one bar each.
 *
 * Ordinal, not hourly. An hourly axis forces every service onto one cadence,
 * and the estate does not have one: Noise assesses every few minutes, WBGT runs
 * hourly inside site hours, Subcon reports twice a day. On that axis a
 * twice-daily project is 48 grey gaps and two coloured bars, which reads as a
 * broken service rather than a quiet one, and the gaps crowd out the runs that
 * actually happened.
 *
 * So a bar is a PROCESS — one run, or one delivery attempt — and a hundred bars
 * are the last hundred of them however long they took. Every bar is then a real
 * event, which is also what makes the strip clickable: there is something
 * behind each one.
 *
 * Newest on the right, so the strip reads as time and new processes append
 * where the eye already is.
 */

export type Sample = {
  /** When it ran. Used only to order and to label, never to bucket. */
  at: string;
  colour: HealthColour;
  /** The service's own word, kept for the expanded view. */
  status: string;
  /**
   * What the service wrote about it — one line per problem it recorded.
   *
   * Empty for a clean process, and often empty for a failed one too: not every
   * service records a reason. Kept as a list rather than joined, because
   * `wbgt_job_runs.errors` is already one entry per affected sensor and those
   * read as separate findings.
   */
  log: string[];
};

export type Bar = Sample;

export type KeyedSample = Sample & {
  /** Which strip this belongs to — `healthKey(service, projectCode)`. */
  key: string;
};

export const BAR_COUNT = 100;

/**
 * How far back a strip will look, in hours.
 *
 * A floor as well as a count. Without it the keyset walk has no reason to stop
 * early on a quiet project and the database has no time index to lean on; with
 * it, every page is bounded and Postgres can seek instead of scan.
 *
 * It also changes what a short strip MEANS, for the better: fewer than a hundred
 * bars now says "this is all that ran in two days", which is itself worth
 * seeing, rather than "this is all we bothered to fetch".
 */
export const WINDOW_HOURS = 48;

/**
 * The newest `bars` samples for one project, oldest first.
 *
 * Sorted here rather than trusted from the query: the samples arrive newest
 * first and are concatenated across several pages and two different readers, so
 * ordering is this function's job, not its caller's.
 */
export function stripFrom(samples: Sample[], bars = BAR_COUNT): Bar[] {
  return samples
    // A sample with no timestamp cannot be ordered or labelled, and reaching the
    // bars it crashes the card on `formatSgt(undefined)`. The readers already
    // drop these, so the guard is for the shape changing underneath a live
    // cache — which is exactly what happened when these bars stopped being
    // hourly buckets and the five-minute cache still held the old objects.
    .filter((sample) => typeof sample?.at === "string" && sample.at)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, bars)
    .reverse();
}

/** One strip per key. A key with no samples gets none, not a row of blanks. */
export function stripsFrom(samples: KeyedSample[], bars = BAR_COUNT): Map<string, Bar[]> {
  const grouped = new Map<string, Sample[]>();
  for (const { key, ...sample } of samples) {
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) existing.push(sample);
    else grouped.set(key, [sample]);
  }

  const strips = new Map<string, Bar[]>();
  for (const [key, group] of grouped) strips.set(key, stripFrom(group, bars));
  return strips;
}

/**
 * No uptime figure, deliberately.
 *
 * A percentage answers "how available were we", which is a status-page question
 * and not this estate's. A strip reading "48 % clean" invites "is that bad?",
 * which nobody can answer without knowing the service — whereas the faults
 * themselves are always actionable. So the strip counts what needs looking at
 * and lists it on click, and there is no score to interpret.
 */

/** Every amber and red process, newest first — one row each, for the modal. */
export function troubleIn(bars: Bar[]): Bar[] {
  return bars.filter((bar) => bar.colour !== "green").reverse();
}

/** How many processes need looking at — what the strip counts. */
export function troubleCount(bars: Bar[]): number {
  return bars.filter((bar) => bar.colour !== "green").length;
}

export type Severity = { red: number; amber: number };

/** How much of a strip needs looking at, split by how badly. */
export function severityOf(bars: Bar[] | undefined): Severity {
  let red = 0;
  let amber = 0;
  for (const bar of bars ?? []) {
    if (bar.colour === "red") red += 1;
    else if (bar.colour === "amber") amber += 1;
  }
  return { red, amber };
}

/**
 * Order two projects by how much attention their strips are asking for.
 *
 * Lexicographic on (red, amber), not a weighted sum: ONE red outranks any
 * number of ambers, however many. That is a deliberate refusal to let a
 * chronic, tolerated amber — a project logging `completed_with_issues` on every
 * run — outrank a single hard failure. A score with weights would eventually be
 * tuned until it did, because the amber counts are so much larger.
 *
 * Returns a comparator value: negative sorts `a` first.
 */
export function bySeverity(a: Severity, b: Severity): number {
  if (a.red !== b.red) return b.red - a.red;
  return b.amber - a.amber;
}
