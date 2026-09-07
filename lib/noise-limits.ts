/**
 * Reading `noise-meters.noise_limits` for display.
 *
 * Two facts about that table shape everything here.
 *
 * **It is stored per hour, not per band.** NoiseLynx presents a meter's
 * permissible levels as eight uneven bands — 7am–7pm, 7pm–8pm, 8pm–10pm,
 * 10pm–12am, 12am–2am, 2am–5am, 5am–6am, 6am–7am — and the refresh expands each
 * into one row per hour, so a meter is 48 rows (24 hours × Mon-Sat / Sun-PH).
 * Showing 48 rows would be unreadable and, worse, would not look like the page
 * an operator is checking against, so consecutive hours holding the same three
 * limits are collapsed back into a band here.
 *
 * The collapse joins equal-valued hours but NEVER crosses one of the eight
 * boundaries. Both halves of that matter and the first was learned the hard way:
 * collapsing purely by runs of equal values rendered HMD NM04 as four Mon-Sat
 * rows against the eight on its page — because 12am-2am, 2am-5am, 5am-6am and
 * 6am-7am all hold 61, and 7pm-8pm and 8pm-10pm both hold 71/68. Nothing was
 * wrong with the data, but a view whose whole job is to be checked against that
 * page did not look like it, and the reasonable conclusion was that the numbers
 * had changed. Fidelity to the source grid is the feature.
 *
 * Stopping at the boundaries rather than snapping to them keeps the other half:
 * an hour inside a band that differs still splits out and is visible, instead of
 * hiding behind whichever hour a canonical grid happened to sample.
 *
 * **A row's protection from the refresh is a substring of `source_file`.** The
 * noise service's `mergeLimitRows` keeps a row's limits, rather than taking the
 * scraped ones, when the stored `source_file` contains "manual source of truth".
 * That string is the whole mechanism, so it is named once here and once there.
 */

/**
 * The marker that survives a refresh.
 *
 * Matched case-insensitively as a SUBSTRING, exactly as
 * `scrapers/noiselynx/limits.js` → `isManualSourceOfTruth` does in the noise
 * repo. The rest of the value is free text and is used to say where the numbers
 * came from — "Manual source of truth - SJC NM01 adjusted limits 2026-08-14".
 *
 * HALO only ever READS this. It is defined here so the badge cannot drift from
 * the behaviour it reports; a test asserts the two spellings still agree.
 */
export const MANUAL_SOURCE_MARKER = "manual source of truth";

export function isProtectedFromRefresh(sourceFile: unknown): boolean {
  return String(sourceFile ?? "").toLowerCase().includes(MANUAL_SOURCE_MARKER);
}

/** One hourly row as the table stores it. */
export type LimitRow = {
  full_identifier?: string | null;
  noise_meter_loc?: string | null;
  day_type_normalized?: string | null;
  hour_start_minutes?: number | null;
  hour_end_minutes?: number | null;
  leq_5min?: number | null;
  leq_1hr?: number | null;
  leq_12hr?: number | null;
  source_file?: string | null;
  subscription_end_date?: string | null;
  rec_id?: string | null;
};

export type LimitBand = {
  /** Minutes from midnight, so 0–120 is 12am–2am. */
  startMinutes: number;
  endMinutes: number;
  /** "12am–2am" — the way the NoiseLynx grid labels it. */
  label: string;
  /** How many hourly rows collapsed into this band. */
  hours: number;
  leq5min: number | null;
  leq1hr: number | null;
  leq12hr: number | null;
  /**
   * The limit an hourly assessment is actually compared against, and where it
   * came from.
   *
   * `buildLimitResult` in the noise service falls back to the Leq12hr limit when
   * a band has no Leq1hr — and reports the substitution, so the outbound message
   * can disclose it. Both halves matter and neither is visible in the source
   * grid, where a missing Leq1hr and a missing Leq12hr are both just `0`:
   *
   * - Mon-Sat 7am–7pm on HMD NM04: no Leq1hr, Leq12hr 76 → the hourly limit is
   *   76, borrowed.
   * - Sun/PH 7pm–8pm on the same meter: no Leq1hr AND no Leq12hr → there is no
   *   hourly limit at all.
   *
   * Leq5min never borrows: it governs a different assessment window.
   */
  hourly: { limit: number | null; borrowedFrom12hr: boolean };
};

export type MeterLimits = {
  fullIdentifier: string;
  meterLoc: string;
  recId: string | null;
  /** Any row survives the refresh — see MANUAL_SOURCE_MARKER. */
  isProtected: boolean;
  /**
   * Protection per day type, because that is how it is actually stored.
   *
   * `mergeLimitRows` decides row by row, and TRI NM01 is the live proof that a
   * meter can be half and half: its 24 Mon-Sat rows carry the marker and its 24
   * Sun/PH rows are refreshed from NoiseLynx. One lock on the meter would say
   * "these numbers are safe" about a day type that gets overwritten.
   */
  monSatProtected: boolean;
  sunPhProtected: boolean;
  /** Verbatim, because it is where the numbers came from. */
  sourceFile: string | null;
  subscriptionEndDate: string | null;
  monSat: LimitBand[];
  sunPh: LimitBand[];
};

function twelveHour(minutes: number): string {
  const hour = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

/** "12am–2am", and "12am–12am" for a band that wraps the whole day. */
export function bandLabel(startMinutes: number, endMinutes: number): string {
  return `${twelveHour(startMinutes)}–${twelveHour(endMinutes)}`;
}

function limitOrNull(value: unknown): number | null {
  const parsed = Number(value);
  // Matches `positiveLimitOrNull` in the noise service: a 0 on the NoiseLynx
  // page means "no limit for this metric in this band", not a limit of zero.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Minutes from midnight where the source grid starts a new column.
 *
 * 12am, 2am, 5am, 6am, 7am, 7pm, 8pm, 10pm — the eight uneven bands NoiseLynx
 * presents. A collapse never merges across one of these, so the rendered rows
 * are always the rows on the page.
 */
const BAND_BOUNDARIES = new Set([0, 2 * 60, 5 * 60, 6 * 60, 7 * 60, 19 * 60, 20 * 60, 22 * 60]);

function hourlyFor(leq1hr: number | null, leq12hr: number | null): LimitBand["hourly"] {
  if (leq1hr !== null) return { limit: leq1hr, borrowedFrom12hr: false };
  return { limit: leq12hr, borrowedFrom12hr: leq12hr !== null };
}

/**
 * Hourly rows for one day type, collapsed into bands.
 *
 * Sorted by start minute first, because the display order is the day's order and
 * the table's own order is not guaranteed. Rows are joined only when they are
 * contiguous, hold the same three limits, AND the later one does not begin a
 * band of its own — a gap is left as a gap rather than bridged, since a missing
 * hour is not the same as a covered one.
 */
export function collapseToBands(rows: LimitRow[]): LimitBand[] {
  const hourly = rows
    .map((row) => ({
      start: Number(row.hour_start_minutes ?? NaN),
      end: Number(row.hour_end_minutes ?? NaN),
      leq5min: limitOrNull(row.leq_5min),
      leq1hr: limitOrNull(row.leq_1hr),
      leq12hr: limitOrNull(row.leq_12hr),
    }))
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end))
    .sort((left, right) => left.start - right.start);

  const bands: LimitBand[] = [];
  for (const row of hourly) {
    const open = bands[bands.length - 1];
    const sameLimits =
      open &&
      open.leq5min === row.leq5min &&
      open.leq1hr === row.leq1hr &&
      open.leq12hr === row.leq12hr;
    if (open && sameLimits && open.endMinutes === row.start && !BAND_BOUNDARIES.has(row.start)) {
      open.endMinutes = row.end;
      open.hours += 1;
      open.label = bandLabel(open.startMinutes, open.endMinutes);
      continue;
    }
    bands.push({
      startMinutes: row.start,
      endMinutes: row.end,
      label: bandLabel(row.start, row.end),
      hours: 1,
      leq5min: row.leq5min,
      leq1hr: row.leq1hr,
      leq12hr: row.leq12hr,
      hourly: hourlyFor(row.leq1hr, row.leq12hr),
    });
  }
  return bands;
}

/** Every meter in one project's limit rows, ready to render. */
export function groupLimitsByMeter(rows: LimitRow[]): MeterLimits[] {
  const byMeter = new Map<string, LimitRow[]>();
  for (const row of rows) {
    const identifier = String(row.full_identifier ?? "").trim();
    if (!identifier) continue;
    if (!byMeter.has(identifier)) byMeter.set(identifier, []);
    byMeter.get(identifier)!.push(row);
  }

  return [...byMeter.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fullIdentifier, meterRows]) => {
      const dayRows = (dayType: string) =>
        meterRows.filter((row) => String(row.day_type_normalized ?? "") === dayType);
      // Any protected row protects the meter's display badge, and the source is
      // reported for whichever row carries it: `mergeLimitRows` decides per row,
      // so a partially-marked meter is a real state and must not read as clean.
      const marked = meterRows.find((row) => isProtectedFromRefresh(row.source_file));
      const protectedIn = (dayType: string) =>
        dayRows(dayType).some((row) => isProtectedFromRefresh(row.source_file));
      const sources = [...new Set(meterRows.map((row) => String(row.source_file ?? "").trim()).filter(Boolean))];
      return {
        fullIdentifier,
        meterLoc: String(meterRows[0]?.noise_meter_loc ?? "").trim() || fullIdentifier,
        recId: String(meterRows[0]?.rec_id ?? "").trim() || null,
        isProtected: Boolean(marked),
        monSatProtected: protectedIn("mon_sat"),
        sunPhProtected: protectedIn("sun_ph"),
        // Several values means the meter is mid-migration between sources, which
        // is worth seeing rather than collapsing to the first one.
        sourceFile: sources.length ? sources.join(" · ") : null,
        subscriptionEndDate:
          meterRows.map((row) => row.subscription_end_date).find((value) => Boolean(value)) ?? null,
        monSat: collapseToBands(dayRows("mon_sat")),
        sunPh: collapseToBands(dayRows("sun_ph")),
      };
    });
}
