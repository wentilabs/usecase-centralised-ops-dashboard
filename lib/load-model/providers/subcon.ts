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
    const hour = plainHour(config.morning_report_start_hour);

    // Two separate reports to the same destination — activity + manpower, and
    // manpower + machines — each its own message, so each its own send.
    const reports = [
      config.enable_activity_summary === true ? "activity + manpower report" : null,
      config.enable_manpower_summary === true ? "manpower + machines report" : null,
    ].filter((label): label is string => Boolean(label));

    // No group set means nothing is delivered, which the card already says;
    // here it means no sends rather than a bar with no recipients.
    if (hour !== null && reportGroups > 0) {
      for (const cadence of reports) {
        occurrences.push({ service: "subcon", projectCode, cadence, hour, sends: reportGroups, certainty: "scheduled" });
      }
    }

    if (config.enable_housekeeping === true) {
      const housekeeping = countIn(config, "safety_group_ids");
      if (housekeeping > 0) {
        ambient.push({
          service: "subcon",
          projectCode,
          reason: "Nightly housekeeping report — no configurable hour in the config",
          groups: housekeeping,
        });
      }
    }

    return { occurrences, ambient };
  },
};
