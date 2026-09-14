import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { fiveMinCrossings, isManualIngestion, mutesSuffix } from "../schedule-helpers";

/** Service-owned card schedule and cadence semantics. */
export const wbgtScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    const parts: string[] = [];
    if (config.enable_hourly) parts.push(":00 hourly");
    if (config.enable_intermittent_reports) {
          parts.push(
            String(config.intermittent_reports_formatter ?? "red15").toLowerCase() === "red30"
              ? ":30 if High"
              : ":30 if Moderate+, :15/:45 if High",
          );
        }
    if (config.enable_5min_alerts) parts.push(`5-min on ${fiveMinCrossings(config)} crossings`);
    if (config.water_parade_enabled) {
          // The cooldown changes how often a site is asked, which is the part an
          // operator is answering questions about — worth a clause, not just a pill.
          parts.push(
            config.water_parade_cooldown_enabled
              // Phrased as the lookback the code performs — `cooldownHourBands`
              // checks the two preceding hour bands of the same day — rather than
              // "one per 3 bands", which is the same rule stated as arithmetic and
              // reads as a contradiction next to the "cooldown 2h" pill.
              ? "Water Parade reminders, skipped if a cycle ran in the previous 2 hour bands"
              : "Water Parade reminders",
          );
        }
    if (!parts.length) {
          return isManualIngestion("wbgt", config)
            ? "Manual photo ingestion — readings arrive as photos; no scheduled message"
            : "No cadences enabled";
        }
    let line = `${parts.join(" · ")} — site hours ${config.site_hours_start}:00–${config.site_hours_end}:00`;
    if (config.skip_lunch_hour) line += ", skips 12:00";
    return line + mutesSuffix(config).replace(" — muted", ", muted");
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return Boolean(
          config.enable_hourly ||
            config.enable_intermittent_reports ||
            config.enable_5min_alerts ||
            // Water Parade sends its own reminders, so the project is not idle.
            config.water_parade_enabled,
        );
  },
};
