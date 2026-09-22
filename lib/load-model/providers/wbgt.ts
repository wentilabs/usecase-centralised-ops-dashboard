import { countIn, isEnabled, plainHour, plainWindowHours, wbgtSenders } from "../helpers";
import type { LoadProvider, Occurrence, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/**
 * Read from the WBGT repo's `lib/wbgt-cadence.js` and `usecases/wbgt`.
 *
 * The notification endpoint is invoked four times an hour and
 * `shouldFireForCadence` decides what each invocation does by its 15-minute
 * bucket: the top of the hour belongs to the hourly report, and :15/:30/:45
 * belong to the intermittent one. At hourly resolution that collapses to "one
 * hourly send, plus up to three intermittent ones".
 */
export const wbgtLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const occurrences: Occurrence[] = [];
    const senders = wbgtSenders(config);
    // Per-sensor delivery replaces the project fan-out rather than adding to
    // it: each sensor posts to its own mapped group, one group each.
    const perSend = senders > 1 ? senders : countIn(config, "whatsapp_group_id");

    let hours = plainWindowHours(config.site_hours_start, config.site_hours_end);
    // The service skips the lunch hour outright, so nothing is due at 12:00.
    if (config.skip_lunch_hour) hours = hours.filter((hour) => hour !== 12);

    const add = (
      hour: number,
      cadence: string,
      sends: number,
      certainty: Occurrence["certainty"],
    ) => {
      if (sends > 0) occurrences.push({ service: "wbgt", projectCode, cadence, hour, sends, certainty });
    };

    // Defaults to ON: the service reads `enable_hourly !== false`.
    if (config.enable_hourly !== false) {
      for (const hour of hours) add(hour, "hourly report", perSend, "scheduled");
    }

    if (config.enable_intermittent_reports === true) {
      // red30 fires at :30 and only in the high band — one chance an hour.
      // red15 fires at :30 from moderate up and at :15/:45 when high, so three.
      const perHour =
        String(config.intermittent_reports_formatter ?? "red15").toLowerCase() === "red30" ? 1 : 3;
      for (const hour of hours) {
        add(hour, "intermittent report", perSend * perHour, "conditional");
      }
    }

    if (config.enable_5min_alerts === true) {
      // Edge-triggered on a band crossing, on the 5-minute job. Eleven is the
      // arithmetic ceiling — twelve ticks an hour less the top of the hour,
      // which the hourly report owns — and a real hour is nowhere near it. It
      // is counted as the ceiling because that is what `conditional` means
      // here, and because a heat spike crossing back and forth is exactly the
      // burst this view exists to show.
      for (const hour of hours) add(hour, "5-min band alert", perSend * 11, "conditional");
    }

    if (config.water_parade_enabled === true) {
      const groups = countIn(config, "water_parade_outbound_group_id");
      for (const hour of hours) {
        // A cycle starts only when the top-of-hour band is hot, and the
        // cooldown suppresses one that follows within two hour bands — so the
        // sustained rate is lower than this, but any single hour can carry one.
        add(hour, "Water Parade reminder", groups, "conditional");
      }
      if (config.water_parade_daily_summary_enabled === true) {
        const hour = plainHour(config.water_parade_daily_summary_hour);
        // The endpoint runs every hour and each project sends at its own; with
        // no hour set there is nothing to place, so it is left out rather than
        // guessed at midnight.
        if (hour !== null) add(hour, "Water Parade daily summary", groups, "scheduled");
      }
    }

    return { occurrences, ambient: [] };
  },
};
