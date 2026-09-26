import type { ProjectConfigRow, ServiceKey } from "../services";

/**
 * How sure we are that a send happens in the hour it is placed in.
 *
 * The distinction is the whole point of this model. A chart that added a
 * guaranteed hourly report to a worst-case exceedance burst and drew one bar
 * would be a number that is true of neither: too high to plan around and too
 * low to be a ceiling.
 *
 * - `scheduled`  — it fires in that hour whatever the data says.
 * - `conditional` — it fires only if the readings qualify. The count is the
 *   WORST case for that hour, so it reads as capacity rather than as a
 *   forecast.
 * - `ambient` — real outbound traffic with no clock position at all: a
 *   lightning storm, a CCTV bot posting, a foreman forwarding a photo. Kept
 *   out of the hourly buckets entirely rather than smeared across them.
 */
export type Certainty = "scheduled" | "conditional";

/** One cadence's sends, in one hour, for one project. */
export type Occurrence = {
  service: ServiceKey;
  projectCode: string;
  /** What fires — short enough for a tooltip row. */
  cadence: string;
  /** 0–23, Singapore time. */
  hour: number;
  /**
   * Outbound actions: one message to one group counts as one, so a report to
   * three groups is three. That is the unit the WhatsApp provider rate-limits
   * and the unit the question was asked in.
   */
  sends: number;
  certainty: Certainty;
};

/** Traffic this model refuses to place on a clock, and why. */
export type Ambient = {
  service: ServiceKey;
  projectCode: string;
  /** Why it has no hour — shown verbatim beside the chart. */
  reason: string;
  /** Destinations it would reach when it does fire. */
  groups: number;
};

export type RowLoad = { occurrences: Occurrence[]; ambient: Ambient[] };

/**
 * One service's reading of its own configuration.
 *
 * Deliberately shaped like `lib/card-summary/schedule-providers`, and for the
 * same reason: the cadence rules belong next to the service that owns them, so
 * a change to one cannot quietly alter another's numbers.
 *
 * This is a MIRROR of behaviour that lives in another repository, like
 * `lib/row-rules.ts` mirrors the CHECK constraints — so it drifts the same way.
 * Every provider cites the file it was read from.
 */
export type LoadProvider = { forRow(config: ProjectConfigRow): RowLoad };
