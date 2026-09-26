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
    // "Every tick while a qualifying strike is in range" was true until
    // INV-LTG-09: RED is now emitted ONCE per STOP episode, later strikes send
    // nothing, and STOP→WATCH is silent. The old wording described a stream of
    // messages where there is now one, which is the difference between a site
    // that is being pestered and one that is not.
    return (
      `${scope} — one RED per stop, then the all-clear once both strike types have been ` +
      `outside the red ring for the full red dwell, working hours ${hours}${mutesSuffix(config)}`
    );
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return config.enabled !== false;
  },
};
