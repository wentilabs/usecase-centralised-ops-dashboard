import { countIn, hourOf, isEnabled, windowHours } from "../helpers";
import type { LoadProvider, Occurrence, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/** The override's guaranteed slots, from `isFourHourlySlot` in the haze repo. */
const FOUR_HOURLY_SLOTS = [8, 10, 12, 14, 16, 18, 20];

/**
 * Read from the haze repo's `src/domain/haze-schedule.ts` and its README.
 *
 * One advisory an hour, delivered at :02, to every id in `wa_group_ids`. The
 * column named `four_hourly` has fired every two hours since `ca13cbd`; its
 * slots ignore both the band gate and the working-hours window, which is why
 * they are counted as scheduled while the ordinary hours may not be.
 */
export const hazeLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const occurrences: Occurrence[] = [];
    const groups = countIn(config, "wa_group_ids");
    if (groups === 0) return { occurrences, ambient: [] };

    const hours = windowHours(config.working_hours_start_hhmm, config.working_hours_end_hhmm);
    const override = config.four_hourly === true;
    // A PSI floor makes the advisory conditional: below the band nothing is
    // sent. Blank means every hour in the window really does send.
    const gated = Boolean(String(config.alert_only_when_at_least ?? "").trim());

    const add = (hour: number, cadence: string, certainty: Occurrence["certainty"]) => {
      occurrences.push({ service: "haze", projectCode, cadence, hour, sends: groups, certainty });
    };

    for (const hour of hours) {
      // An overridden slot is guaranteed whatever the band, so it is not
      // counted twice — the slot's send IS the hour's advisory.
      if (override && FOUR_HOURLY_SLOTS.includes(hour)) continue;
      add(hour, "hourly advisory", gated ? "conditional" : "scheduled");
    }

    if (override) {
      for (const hour of FOUR_HOURLY_SLOTS) {
        // Outside the working-hours window as well as inside it — that is what
        // makes the 20:00 slot fire for a site that closes at 19:00.
        add(hour, "guaranteed 2-hourly send", "scheduled");
      }
    } else {
      // One "service is live" message per project per SGT day. Placed at the
      // start of the working window, which is when the day's first advisory
      // runs; with no window set the service has no earlier anchor than 00:00.
      add(hourOf(config.working_hours_start_hhmm) ?? 0, "daily kickoff", "scheduled");
    }

    return { occurrences, ambient: [] };
  },
};
