import { ASSESS_COL, splitList } from "../../card-summary/groups";
import { ALL_HOURS, countIn, hourOf, isEnabled, windowHours } from "../helpers";
import type { LoadProvider, Occurrence, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/**
 * Read from the noise repo's `usecases/noise/scrape-demand.js`, which is the
 * service's own minute-by-minute map of what fires when, plus the per-cadence
 * jobs for whether a tick actually sends.
 *
 * Hours from that map: the 5-minute and half-hourly families run on ticks at
 * every fifth minute from :03, the 15-minute average at :17/:32/:47, hourly at
 * :04, the morning summary at 07:00, the evening one at 19:00, and the
 * three-hour summary at 10, 13, 16 and 19.
 */

/** Summaries go out every tick; exceedance formatters only when a limit breaks. */
function fiveMinuteCertainty(config: ProjectConfigRow): Occurrence["certainty"] {
  const formatter = String(config.five_min_formatter ?? "").trim().toLowerCase();
  return formatter.startsWith("summary") ? "scheduled" : "conditional";
}

export const noiseLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const occurrences: Occurrence[] = [];
    const groups = countIn(config, "whatsapp_group_id");

    const add = (
      hours: number[],
      cadence: string,
      perHour: number,
      certainty: Occurrence["certainty"],
      destinations = groups,
    ) => {
      const sends = perHour * destinations;
      if (sends <= 0) return;
      for (const hour of hours) {
        occurrences.push({ service: "noise", projectCode, cadence, hour, sends, certainty });
      }
    };

    if (config.enable_5min === true) {
      // Twelve ticks an hour, from :03. Whether each one SENDS depends on the
      // formatter, not on the hour, which is why the certainty is read from
      // the column rather than assumed.
      add(
        windowHours(config.five_min_start_hhmm, config.five_min_end_hhmm),
        "5-min reading",
        12,
        fiveMinuteCertainty(config),
      );
    }

    if (config.enable_half_hourly === true) {
      // One send per configured assessment minute — the column decides how
      // many of the five-minute ticks actually emit. Blank means a single :30.
      const marks = splitList(config[ASSESS_COL]).length || 1;
      add(
        windowHours(config.half_hourly_start_hhmm, config.half_hourly_end_hhmm),
        "half-hourly assessment",
        marks,
        "scheduled",
      );
      // An opt-in second destination that receives only the messages carrying
      // a warning band, so it is conditional even though the send is not.
      if (config.half_hourly_send_if_exceed === true) {
        add(
          windowHours(config.half_hourly_start_hhmm, config.half_hourly_end_hhmm),
          "half-hourly warning relay",
          marks,
          "conditional",
          countIn(config, "exceedance_half_hourly_wa_groups"),
        );
      }
    }

    if (config.enable_hourly === true) {
      add(
        windowHours(config.hourly_start_hhmm, config.hourly_end_hhmm),
        "hourly report",
        1,
        // `hourly_exceedance_only` turns the guaranteed report into one that
        // goes out only when a limit was breached.
        config.hourly_exceedance_only === true ? "conditional" : "scheduled",
      );
    }

    if (config.enable_15min_average_exceedance === true) {
      // Three marks an hour, and an exceedance report by name.
      add(
        windowHours(config.fifteen_min_average_start_hhmm, config.fifteen_min_average_end_hhmm),
        "15-min average exceedance",
        3,
        "conditional",
      );
    }

    // The fixed-hour jobs. These carry no window of their own.
    if (config.enable_three_hour_summary === true) {
      add([10, 13, 16, 19], "3-hour summary", 1, "scheduled");
    }
    if (config.enable_morning_summary === true) {
      add([hourOf(config.morning_summary_start_hhmm) ?? 7], "morning summary", 1, "scheduled");
    }
    if (config.enable_evening_summary === true) {
      add([19], "evening closeout", 1, "scheduled");
    }
    if (config.enable_7am_7pm_leq12h_table === true || config.enable_7am_7pm_leq12hr_table === true) {
      add(
        ALL_HOURS.filter((hour) => hour >= 8 && hour <= 19),
        "Leq12hr table",
        1,
        "scheduled",
      );
    }
    /**
     * Two cadences are deliberately absent from the hourly buckets.
     *
     * `enable_sunday_leq12h_hourly` runs 08:00–19:00 on SUNDAYS only, so it is
     * not part of the weekday this chart describes — drawing it would inflate
     * every ordinary day by twelve sends.
     *
     * `allow_expiry_alert` warns that a meter's calibration is running out. It
     * has no configurable hour, and inventing one would put a bar where
     * nothing is known to happen.
     */

    return { occurrences, ambient: [] };
  },
};
