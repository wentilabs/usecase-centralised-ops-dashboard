import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { formatHhmm, mutesSuffix } from "../schedule-helpers";

/** Service-owned card schedule and cadence semantics. */
export const hazeScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    const bothEnds = Boolean(config.working_hours_start_hhmm && config.working_hours_end_hhmm);
    const hours = bothEnds
          ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
          : "all day";
    const gate = config.alert_only_when_at_least
          ? ` — only when PSI ≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
          : "";
    if (config.four_hourly) {
          // Every two hours since ca13cbd, not four — the column name did not
          // change with the behaviour. Listed as a range rather than seven times,
          // which is what an operator is actually checking.
          //
          // The override sends at those hours whatever the band AND outside the
          // working-hours window, which is why the 20:00 slot fires for a project
          // whose window closes at 19:00. Every other hour follows the ordinary
          // gates, so the floor is still quoted — dropping it would imply the
          // whole day ignores it.
          return `hourly advisory during ${hours}${gate}, plus a guaranteed send every 2 hours from 08:00 to 20:00 whatever the band and outside those hours — no daily kickoff${mutesSuffix(
            config,
          )}`;
        }
    return `hourly advisory during ${hours}${gate}${mutesSuffix(config)}`;
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return config.enabled !== false;
  },
};
