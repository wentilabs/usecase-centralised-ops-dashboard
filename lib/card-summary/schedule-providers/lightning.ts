import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { formatHhmm, mutesSuffix } from "../schedule-helpers";

/** Service-owned card schedule and cadence semantics. */
export const lightningScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    const hours =
          config.working_hours_start_hhmm || config.working_hours_end_hhmm
            ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
            : "all day";
    const scope = config.amber_enabled === false ? "red-only" : "red + amber";
    return `${scope} — every tick while a qualifying strike is in range, working hours ${hours}${mutesSuffix(config)}`;
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return config.enabled !== false;
  },
};
