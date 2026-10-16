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
 * So a bar is a PROCESS — one run, or one delivery attempt — and fifty bars are
 * the last fifty of them however long they took. Every bar is then a real
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
};

export type Bar = Sample;

export type KeyedSample = Sample & {
  /** Which strip this belongs to — `healthKey(service, projectCode)`. */
  key: string;
};

export const BAR_COUNT = 50;

/**
 * The newest `bars` samples for one project, oldest first.
 *
 * Sorted here rather than trusted from the query: the samples arrive newest
 * first and are concatenated across several pages and two different readers, so
 * ordering is this function's job, not its caller's.
 */
export function stripFrom(samples: Sample[], bars = BAR_COUNT): Bar[] {
  return [...samples]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, bars)
    .reverse();
}

/** One strip per key. A key with no samples gets none, not a row of blanks. */
export function stripsFrom(samples: KeyedSample[], bars = BAR_COUNT): Map<string, Bar[]> {
  const grouped = new Map<string, Sample[]>();
  for (const { key, ...sample } of samples) {
    const existing = grouped.get(key);
    if (existing) existing.push(sample);
    else grouped.set(key, [sample]);
  }

  const strips = new Map<string, Bar[]>();
  for (const [key, group] of grouped) strips.set(key, stripFrom(group, bars));
  return strips;
}

/**
 * The share of these processes that passed.
 *
 * Every bar is a process that really ran, so this divides by what is on screen
 * and the number cannot disagree with the bars — which was the failure mode of
 * the hourly version, where idle hours had to be excluded from both halves and
 * the arithmetic stopped being visible.
 */
export function healthyShare(bars: Bar[]): number | null {
  if (!bars.length) return null;
  return bars.filter((bar) => bar.colour === "green").length / bars.length;
}

/** `99.82 %`, or a dash when nothing has run. */
export function shareText(share: number | null): string {
  if (share === null) return "—";
  const percent = share * 100;
  // Never rounded up to a clean 100 while a failure is still on the strip: that
  // reads as a contradiction and costs the strip its credibility.
  if (percent < 100 && percent > 99.99) return "99.99 %";
  // Rounded BEFORE deciding whether it is whole: 0.56 * 100 is
  // 56.00000000000001 in binary floating point, so testing the raw product
  // printed "56.0 %" for twenty-eight clean processes out of fifty.
  const tenths = Math.round(percent * 10) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)} %`;
}

export type TroubleGroup = {
  status: string;
  colour: HealthColour;
  count: number;
  /** Oldest and newest occurrence, so a chronic fault reads as a span. */
  from: string;
  to: string;
};

/**
 * The amber and red processes, grouped by what they said.
 *
 * Listing them one per line reproduces the alarm fatigue the colours were
 * introduced to fix, one layer down: C991's expanded strip was twenty-six
 * identical `completed_with_issues` lines, which is one chronic fault rendered
 * as twenty-six events. Grouped, it reads as "26 times, since 15:58" — the
 * repetition becomes the finding instead of burying it.
 *
 * Ordered by count, because on one project's own card the question is which
 * fault dominates, not which arrived last; the span says when.
 */
export function troubleIn(bars: Bar[]): TroubleGroup[] {
  const groups = new Map<string, TroubleGroup>();
  for (const bar of bars) {
    if (bar.colour === "green") continue;
    const existing = groups.get(bar.status);
    if (existing) {
      existing.count += 1;
      if (bar.at < existing.from) existing.from = bar.at;
      if (bar.at > existing.to) existing.to = bar.at;
      continue;
    }
    groups.set(bar.status, { status: bar.status, colour: bar.colour, count: 1, from: bar.at, to: bar.at });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.colour !== b.colour) return a.colour === "red" ? -1 : 1;
    return b.count - a.count;
  });
}

/** How many processes are covered by these groups — what the strip counts. */
export function troubleCount(bars: Bar[]): number {
  return bars.filter((bar) => bar.colour !== "green").length;
}
