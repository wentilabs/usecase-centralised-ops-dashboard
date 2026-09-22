import { CRONS } from "../crons";
import { countIn, isEnabled, plainHour } from "../helpers";
import type { Ambient, LoadProvider, Occurrence, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/**
 * Read from the subcon repo's `usecases/activity/summary.js` and its README
 * route table.
 *
 * The morning reports are scheduled: the endpoint is invoked and each project
 * runs once its own local hour has reached `morning_report_start_hour`. The
 * housekeeping intake is a webhook — a foreman forwarding a photo — so the
 * events it records have no hour, and the nightly report built from them has
 * no configurable one either.
 */
export const subconLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const occurrences: Occurrence[] = [];
    const ambient: Ambient[] = [];

    const reportGroups = countIn(config, "manpower_activity_outbound_group_id");
    /**
     * `morning_report_start_hour` is a GATE, not a send time.
     *
     * `morningReportGate` allows a run once the current Singapore hour has
     * reached it, so the send lands on whichever of the rule's own hours comes
     * first — not on the configured hour, which is where this placed it before
     * the console's rules were read. An unset column is no gate at all.
     */
    const gate = plainHour(config.morning_report_start_hour);
    const allowed = (hours: readonly number[]) => hours.filter((hour) => gate === null || hour >= gate);

    const add = (hours: readonly number[], cadence: string, sends: number) => {
      if (sends <= 0) return;
      for (const hour of hours) {
        occurrences.push({ service: "subcon", projectCode, cadence, hour, sends, certainty: "scheduled" });
      }
    };

    // No group set means nothing is delivered, which the card already says;
    // here it means no sends rather than a bar with no recipients.
    if (config.enable_activity_summary === true) {
      add(allowed(CRONS.subcon.activitySummary.hours), "activity + manpower report", reportGroups);
    }
    if (config.enable_manpower_summary === true) {
      // TWO rules on this one route — 10:05 and 16:05 Singapore — so a project
      // past its gate is summarised twice a day. `morningReportGate` is a bare
      // `currentSgtHour >= startHour` and there is no once-a-day guard beside
      // it; if one exists elsewhere, this over-counts by one send per project.
      add(allowed(CRONS.subcon.manpowerSummary.hours), "manpower + machines report", reportGroups);
    }

    if (config.enable_housekeeping === true) {
      // 22:10 Singapore, on its own rule. It has a real hour after all, so it
      // belongs on the chart rather than in the "no clock position" list where
      // this model had it.
      add(CRONS.subcon.housekeepingReminder.hours, "nightly housekeeping report", countIn(config, "safety_group_ids"));
    }

    return { occurrences, ambient };
  },
};
