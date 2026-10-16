import { worstColour, type HealthColour } from "./health-status";

/**
 * One project's recent history, as one bar per cycle.
 *
 * The board answers "what is wrong now". It cannot answer "has this been
 * happening all week, or did it start an hour ago" — and that second question
 * is usually the one that locates the cause. Haze is the case in point: it ran
 * clean every hour for two days and then every project went amber at once, at
 * 10:00. A list of thirty-one amber projects does not show that shape; a row of
 * bars with forty-two green and two amber at the right-hand end shows it at a
 * glance, and points straight at what changed at 10:00.
 *
 * One bar is one CYCLE — an hour, because every service here records its runs
 * and deliveries hourly. Newest on the right, so the strip reads as time and
 * new cycles append where the eye already is.
 *
 * Per PROJECT, not per estate. A single rolled-up strip averages seven services
 * on different cadences into a shape nobody can act on; the question a reader
 * actually has is "is THIS site being delivered to", and that is answered on the
 * site's own card.
 */

export type Sample = {
  /** When the attempt was recorded. */
  at: string;
  colour: HealthColour;
};

export type Bar = {
  /** The bucket's hour, as `2026-10-16T10`. */
  hour: string;
  /**
   * `null` for an hour with no attempt at all.
   *
   * Not green: an hour where nothing was recorded is either a cadence the
   * service was not due for or a cycle that never ran, and painting it as a
   * success would be the one lie this strip exists to avoid. It renders as a
   * gap, which is visibly different from both a pass and a failure.
   */
  colour: HealthColour | null;
  count: number;
};

export const BAR_COUNT = 50;

/** `2026-10-16T10:04:33+00:00` → `2026-10-16T10`. */
function hourOf(iso: string): string {
  return iso.slice(0, 13);
}

/** The hour `n` hours before `from`, as a bucket key. */
function hourKey(from: Date, hoursBack: number): string {
  return new Date(from.getTime() - hoursBack * 3_600_000).toISOString().slice(0, 13);
}

/**
 * Bucket samples into the last `bars` hours, oldest first.
 *
 * Every hour in the window gets a bar whether or not anything landed in it, so
 * the strip has a fixed width and a missing cycle leaves a visible hole rather
 * than silently shortening the row.
 */
export function timelineFrom(
  samples: Sample[],
  { now = new Date(), bars = BAR_COUNT }: { now?: Date; bars?: number } = {},
): Bar[] {
  const buckets = new Map<string, { colour: HealthColour | null; count: number }>();
  for (let index = bars - 1; index >= 0; index -= 1) {
    buckets.set(hourKey(now, index), { colour: null, count: 0 });
  }

  for (const sample of samples) {
    const bucket = buckets.get(hourOf(sample.at));
    if (!bucket) continue; // outside the window
    bucket.colour = bucket.colour ? worstColour([bucket.colour, sample.colour]) : sample.colour;
    bucket.count += 1;
  }

  return [...buckets.entries()].map(([hour, bucket]) => ({ hour, ...bucket }));
}

/**
 * The share of cycles that passed, over the cycles that ran.
 *
 * Hours with no attempt are excluded from both halves rather than counted as
 * successes. Most of the estate is idle overnight, and dividing by a fixed 50
 * would report a quiet night as an outage.
 */
export function healthyShare(bars: Bar[]): number | null {
  const ran = bars.filter((bar) => bar.colour !== null);
  if (!ran.length) return null;
  return ran.filter((bar) => bar.colour === "green").length / ran.length;
}

/** `99.82 %`, or a dash when nothing ran. */
export function shareText(share: number | null): string {
  if (share === null) return "— no cycles";
  // Two decimals like a status page, but never rounded UP to a clean 100 while
  // a failure is still in the window: "100.00 %" beside an amber bar reads as a
  // contradiction and costs the strip its credibility.
  const percent = share * 100;
  const text = percent < 100 && percent > 99.99 ? "99.99" : percent.toFixed(2);
  return `${text} %`;
}

export type KeyedSample = Sample & {
  /** Which strip this attempt belongs to — `healthKey(service, projectCode)`. */
  key: string;
};

/**
 * One timeline per key, for the cards.
 *
 * Only keys that appear in `samples` get a timeline. A project nobody recorded
 * an attempt for has no strip at all rather than fifty grey bars, because fifty
 * grey bars on a card look like a system that is broken rather than one that
 * has nothing to say.
 */
export function timelinesFrom(
  samples: KeyedSample[],
  options: { now?: Date; bars?: number } = {},
): Map<string, Bar[]> {
  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const existing = grouped.get(sample.key);
    if (existing) existing.push(sample);
    else grouped.set(sample.key, [sample]);
  }

  const timelines = new Map<string, Bar[]>();
  for (const [key, group] of grouped) timelines.set(key, timelineFrom(group, options));
  return timelines;
}
