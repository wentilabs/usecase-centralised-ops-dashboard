import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { ASSESS_COL } from "../groups";
import { formatHhmm, mutesSuffix, window } from "../schedule-helpers";

/** Service-owned card schedule and cadence semantics. */
export const noiseScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    const parts: string[] = [];
    if (config.enable_5min) parts.push(`5-min${window(config.five_min_start_hhmm, config.five_min_end_hhmm)}`);
    // Its own three minute marks, and no window of its own — it averages the
    // 5-minute readings that just closed, whether or not the 5-minute message
    // is being sent.
    if (config.enable_15min_average_exceedance) {
          parts.push(
            `15-min average exceedance @ :17 :32 :47${window(
              config.fifteen_min_average_start_hhmm,
              config.fifteen_min_average_end_hhmm,
            )}`,
          );
        }
    if (config.enable_half_hourly) {
          const marks = String(config[ASSESS_COL] ?? "30")
            .split(",")
            .map((m) => m.trim().padStart(2, "0"))
            .join(" :");
          const relay = config.half_hourly_send_if_exceed ? ", warnings relayed" : "";
          parts.push(
            `half-hourly @ :${marks}${window(config.half_hourly_start_hhmm, config.half_hourly_end_hhmm)}${relay}`,
          );
        }
    if (config.enable_hourly) parts.push(`hourly${window(config.hourly_start_hhmm, config.hourly_end_hhmm)}`);
    if (config.enable_three_hour_summary) parts.push("3-hr summary");
    if (config.enable_morning_summary) {
          parts.push(
            `morning${config.morning_summary_start_hhmm ? ` @ ${formatHhmm(config.morning_summary_start_hhmm)}` : ""}`,
          );
        }
    if (config.enable_evening_summary) parts.push("evening 7am–7pm closeout @ 19:00");
    if (config.enable_sunday_leq12h_hourly) parts.push("Sunday Leq12h hourly");
    if (config.enable_7am_7pm_leq12hr_table) parts.push("Leq12hr table @ 07:00/19:00");
    if (!parts.length) return "No cadences enabled";
    return parts.join(" · ") + mutesSuffix(config);
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return Boolean(
          config.enable_5min ||
            // A project running only this one is working, not idle.
            config.enable_15min_average_exceedance ||
            config.enable_half_hourly ||
            config.enable_hourly ||
            config.enable_three_hour_summary ||
            config.enable_morning_summary ||
            config.enable_evening_summary ||
            config.enable_sunday_leq12h_hourly ||
            config.enable_7am_7pm_leq12hr_table,
        );
  },
};
