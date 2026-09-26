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
  | { state: "active"; cadence: string; activeHours: number[]; toleranceMs: number };

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

/**
 * How long ago the previous active hour began, from the current one.
 *
 * Wraps across midnight, because a project running 22:00–02:00 has 01:00
 * following 00:00 and a naive subtraction would make that negative. A single
 * active hour in the day gives 24, which is correct: the previous occurrence
 * really was yesterday.
 */
function hoursSincePreviousActive(hours: number[], current: number): number {
  if (hours.length <= 1) return 24;
  const previous = [...hours].reverse().find((hour) => hour < current);
  return previous === undefined ? current + 24 - hours[hours.length - 1] : current - previous;
}

export function activityFor(service: ServiceKey, row: ProjectConfigRow, now: Date): Activity {
  if (row.enabled === false) return { state: "disabled" };

  const { hours, cadenceByHour } = activeHoursFor(service, row);
  if (!hours.length) return { state: "dormant" };

  const hour = sgtHour(now);
  if (!cadenceByHour.has(hour)) return { state: "idle", activeHours: hours };

  return {
    state: "active",
    cadence: cadenceByHour.get(hour) as string,
    activeHours: hours,
    // Plus one hour of grace: a cadence that fires at :05 has not failed at
    // :04, and the gap is measured between hour starts.
    toleranceMs: (hoursSincePreviousActive(hours, hour) + 1) * HOUR_MS,
  };
}

/** One line for the card, saying why nothing is being judged. */
export function activityLabel(activity: Activity): string | null {
  if (activity.state === "disabled") return "Data: idle — project disabled";
  if (activity.state === "dormant") return "Data: idle — no cadences on";
  if (activity.state === "idle") return "Data: idle — outside cadence hours";
  return null;
}
