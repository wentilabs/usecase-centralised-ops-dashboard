import { LOAD_PROVIDERS } from "./load-model";
import type { ProjectConfigRow, ServiceKey } from "./services";

/**
 * Whether a project is supposed to be doing anything right now.
 *
 * Health was judged purely on age: data older than an hour was "delayed", older
 * than four "no recent data", whatever the project was configured to do. That
 * is wrong for most of the estate most of the day. A site whose cadences run
 * 08:00–19:00 stops producing at 19:00 exactly as configured, and calling that
 * a fault every evening trains everyone to ignore the colour — measured at
 * 18:29 on an ordinary working day, the flat budgets put 19 of 32 noise
 * projects in danger, and the jobs' own runs said
 * `skipped_outside_project_cadence_window` for them.
 *
 * So the question is asked the other way round: is this project inside a window
 * where something should have happened? Outside one, there is nothing to judge
 * and the card says `idle` — which also turns the card into a live view of what
 * the site is doing, rather than only what it is configured to do.
 *
 * **The windows are not re-derived here.** `lib/load-model` already reads each
 * service's cadence flags, start/end times and site hours, and is already
 * tested as a mirror of those services. A second reading of the same columns
 * would drift, and the way it would drift is by disagreeing about exactly the
 * hours that decide whether someone is woken up.
 */
export type Activity =
  /** The row is switched off. Nothing is expected, ever. */
  | { state: "disabled" }
  /** Enabled, but no cadence is on, so nothing ever asks for data. */
  | { state: "dormant" }
  /** Has cadences, none of which run in this hour. */
  | { state: "idle"; activeHours: number[] }
  /**
   * Something should have happened this hour.
   *
   * `toleranceMs` is the longest gap the configuration itself can explain: the
   * time since the previous hour this project runs in. For a cadence running
   * every hour of a site day that is one hour; for a once-a-day report it is
   * twenty-four, and judging it at one hour would report a healthy project as
   * broken twenty-three times a day.
   */
  | {
      state: "active";
      cadence: string;
      activeHours: number[];
      toleranceMs: number;
      /**
       * Set when today is a day this project mutes ("Sunday"). The service is still
       * scheduled, so the hour is active, but a silent table is not a fault: the
       * site declared it does not work today. Fresh data still reads as healthy, so
       * a site that DOES report on its muted day is not hidden by this.
       */
      mutedDay?: string;
    };

const HOUR_MS = 60 * 60 * 1000;

/** The hour in Singapore, which is UTC+8 and never shifts. */
export function sgtHour(now: Date): number {
  return new Date(now.getTime() + 8 * HOUR_MS).getUTCHours();
}

/** The hours this project runs in, from the load model's reading of its config. */
export function activeHoursFor(service: ServiceKey, row: ProjectConfigRow): { hours: number[]; cadenceByHour: Map<number, string> } {
  const provider = LOAD_PROVIDERS[service];
  const cadenceByHour = new Map<number, string>();
  if (!provider) return { hours: [], cadenceByHour };

  for (const occurrence of provider.forRow(row).occurrences) {
    // The first cadence named for an hour wins, so the label stays stable
    // rather than changing with iteration order.
    if (!cadenceByHour.has(occurrence.hour)) cadenceByHour.set(occurrence.hour, occurrence.cadence);
  }
  return { hours: [...cadenceByHour.keys()].sort((a, b) => a - b), cadenceByHour };
}

/** The Singapore weekday of an instant: 0 is Sunday. */
function sgtWeekday(at: Date): number {
  return new Date(at.getTime() + 8 * HOUR_MS).getUTCDay();
}

/**
 * The calendar day this project does not work, if the instant falls on one.
 *
 * Sunday only, because it is the one mute HALO can decide from the row alone.
 * Public holidays are the service's calendar, not HALO's, and stay with the
 * service's own run log (`skipped_ph_…`), which the reader already consults.
 */
function mutedDayAt(row: ProjectConfigRow, at: Date): string | null {
  return row.remove_sunday_notifications === true && sgtWeekday(at) === 0 ? "Sunday" : null;
}

/**
 * The longest silence the configuration can explain, from the current hour.
 *
 * Walks back to the previous hour this project works in — skipping muted days,
 * which is what makes Monday morning compare against Saturday and not against a
 * Sunday nobody works. A gap of one hour tolerates one more hour of grace (a job
 * that fires at :05 has not failed at :04). A longer gap is a BREAK — overnight, a
 * lunch skip, a weekend — and tolerates two: the first reading after a break
 * arrives during the first hour back, and judging at its start reported every
 * site as behind each morning until its first reading landed.
 */
function toleranceFrom(hours: number[], row: ProjectConfigRow, now: Date): number {
  const hourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  // Eight days covers a weekend plus a holiday; a project with no work hour in
  // that span is dormant, which was settled before this is asked.
  for (let back = 1; back <= 8 * 24; back += 1) {
    const candidate = new Date(hourStart - back * HOUR_MS);
    if (hours.includes(sgtHour(candidate)) && !mutedDayAt(row, candidate)) {
      return (back + (back > 1 ? 2 : 1)) * HOUR_MS;
    }
  }
  return 26 * HOUR_MS;
}

export function activityFor(service: ServiceKey, row: ProjectConfigRow, now: Date): Activity {
  // Vibration's scrape is scheduled outside the database and does not read
  // `enabled`, so neither a switched-off row nor an empty cadence list means
  // nothing is expected: the portal is scraped round the clock.
  if (service === "vibration") {
    return { state: "active", cadence: "scraping on an external schedule", activeHours: Array.from({ length: 24 }, (_, hour) => hour), toleranceMs: 6 * HOUR_MS };
  }
  if (row.enabled === false) return { state: "disabled" };

  const { hours, cadenceByHour } = activeHoursFor(service, row);
  if (!hours.length) return { state: "dormant" };

  const hour = sgtHour(now);
  if (!cadenceByHour.has(hour)) return { state: "idle", activeHours: hours };

  return {
    state: "active",
    cadence: cadenceByHour.get(hour) as string,
    activeHours: hours,
    toleranceMs: toleranceFrom(hours, row, now),
    ...(mutedDayAt(row, now) ? { mutedDay: mutedDayAt(row, now) as string } : {}),
  };
}

/** One line for the card, saying why nothing is being judged. */
export function activityLabel(activity: Activity): string | null {
  if (activity.state === "disabled") return "Data: idle — project disabled";
  if (activity.state === "dormant") return "Data: idle — no cadences on";
  if (activity.state === "idle") return "Data: idle — outside cadence hours";
  return null;
}
