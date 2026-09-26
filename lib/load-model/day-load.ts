import type { ProjectConfigRow, ServiceKey } from "../services";
import { LOAD_PROVIDERS } from "./providers";
import { ALL_HOURS } from "./helpers";
import type { Ambient, Certainty, Occurrence } from "./types";

/** One hour's total, split by how sure the model is of it. */
export type HourBucket = {
  hour: number;
  scheduled: number;
  conditional: number;
  /** scheduled + conditional — the ceiling for that hour. */
  total: number;
  /** Distinct destination groups involved, across every cadence in the hour. */
  groups: number;
  /** Per service, for the stack. */
  byService: Record<string, { scheduled: number; conditional: number }>;
};

export type DayLoad = {
  hours: HourBucket[];
  ambient: Ambient[];
  /** Totals across the day, for the headline. */
  scheduled: number;
  conditional: number;
  /** The busiest hours by scheduled + conditional, worst first. */
  busiest: HourBucket[];
};

/** Every occurrence a set of rows produces, keyed by service. */
export function occurrencesFor(
  rowsByService: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
): { occurrences: Occurrence[]; ambient: Ambient[] } {
  const occurrences: Occurrence[] = [];
  const ambient: Ambient[] = [];

  for (const [service, rows] of Object.entries(rowsByService) as [ServiceKey, ProjectConfigRow[]][]) {
    const provider = LOAD_PROVIDERS[service];
    // A service HALO has rows for but no provider would silently contribute
    // nothing, which reads as a quiet estate rather than a missing mirror.
    if (!provider) continue;
    for (const row of rows ?? []) {
      const load = provider.forRow(row);
      occurrences.push(...load.occurrences);
      ambient.push(...load.ambient);
    }
  }

  return { occurrences, ambient };
}

/**
 * The day as 24 hourly buckets.
 *
 * Hours are Singapore time throughout, because every service's schedule
 * columns are, and every bucket exists even when empty — an axis with gaps in
 * it is harder to read than one with zeroes.
 *
 * `groups` counts DISTINCT destinations rather than summing them: three
 * cadences to the same group is three sends but one group, and "how many
 * groups are being talked to at 08:00" is a different question from "how many
 * messages".
 */
export function dayLoad(
  rowsByService: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  options: { services?: ServiceKey[]; includeConditional?: boolean } = {},
): DayLoad {
  const { occurrences, ambient } = occurrencesFor(rowsByService);
  const wanted = options.services ? new Set(options.services) : null;
  const keep = occurrences.filter((entry) => !wanted || wanted.has(entry.service));

  const hours: HourBucket[] = ALL_HOURS.map((hour) => ({
    hour,
    scheduled: 0,
    conditional: 0,
    total: 0,
    groups: 0,
    byService: {},
  }));
  // Per hour, which project+service pairs are active — the stand-in for a
  // distinct destination, since a row's group ids are already folded into
  // `sends` by the provider.
  const seen: Map<number, Set<string>> = new Map(ALL_HOURS.map((hour) => [hour, new Set<string>()]));

  for (const entry of keep) {
    const bucket = hours[entry.hour];
    if (!bucket) continue;
    const field: Certainty = entry.certainty;
    bucket[field] += entry.sends;
    const perService = (bucket.byService[entry.service] ??= { scheduled: 0, conditional: 0 });
    perService[field] += entry.sends;
    seen.get(entry.hour)?.add(`${entry.service}:${entry.projectCode}`);
  }

  for (const bucket of hours) {
    bucket.total = bucket.scheduled + (options.includeConditional === false ? 0 : bucket.conditional);
    bucket.groups = seen.get(bucket.hour)?.size ?? 0;
  }

  return {
    hours,
    ambient: ambient.filter((entry) => !wanted || wanted.has(entry.service)),
    scheduled: hours.reduce((sum, bucket) => sum + bucket.scheduled, 0),
    conditional: hours.reduce((sum, bucket) => sum + bucket.conditional, 0),
    busiest: [...hours]
      .filter((bucket) => bucket.total > 0)
      .sort((a, b) => b.total - a.total || a.hour - b.hour)
      .slice(0, 5),
  };
}

/**
 * Every cadence firing in one hour, worst first — what the breakdown lists.
 *
 * Takes the same options as `dayLoad` and must be given the same ones: a
 * breakdown that listed a conditional cadence while the bar above it excluded
 * the ceiling would be a list whose rows do not add up to the column it
 * describes, which is worse than either answer on its own.
 */
export function hourDetail(
  rowsByService: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  hour: number,
  options: { services?: ServiceKey[]; includeConditional?: boolean } = {},
): Occurrence[] {
  const wanted = options.services ? new Set(options.services) : null;
  return occurrencesFor(rowsByService)
    .occurrences.filter(
      (entry) =>
        entry.hour === hour &&
        (!wanted || wanted.has(entry.service)) &&
        (options.includeConditional !== false || entry.certainty === "scheduled"),
    )
    .sort((a, b) => b.sends - a.sends || a.projectCode.localeCompare(b.projectCode));
}

/** `14` → `14:00`. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
