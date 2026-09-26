import { CRONS } from "../crons";
import { countIn, isEnabled, plainHour } from "../helpers";
import type { Ambient, LoadProvider, Occurrence, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/**
 * Read from the ailytics repo's routes: `/ailytics-safety/whatsapp-events` is
 * a webhook and `/ailytics-safety/yesterday-24h-summary` is invoked hourly,
 * each project sending at its own configured hour.
 *
 * So this service is split across both halves of the model: the forwarding is
 * ambient — it happens when the CCTV bot posts, which is a camera's business —
 * while the daily summary has a real, configured hour.
 */
export const ailyticsLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const occurrences: Occurrence[] = [];
    const ambient: Ambient[] = [];

    if (config.forward_pending_to_whatsapp === true) {
      const groups = countIn(config, "whatsapp_group_ids");
      if (groups > 0) {
        ambient.push({
          service: "ailytics",
          projectCode,
          reason: "Forwarded when the CCTV bot posts a detection",
          groups,
        });
      }
    }

    if (config.status_summary_enabled === true) {
      // 10:00 UTC — 18:00 Singapore, daily, on its own rule. No hour column:
      // the rule is the schedule. Sent to the project's delivery list, which
      // is the only outbound list ailytics has besides the yesterday-summary
      // one.
      const groups = countIn(config, "whatsapp_group_ids");
      for (const hour of CRONS.ailytics.statusSummary.hours) {
        if (groups > 0) {
          occurrences.push({
            service: "ailytics",
            projectCode,
            cadence: "issues status summary",
            hour,
            sends: groups,
            certainty: "scheduled",
          });
        }
      }
    }

    if (config.yesterday_summary_enabled === true) {
      const hour = plainHour(config.yesterday_summary_hour);
      // Its own destination column, not the forwarding list.
      const groups = countIn(config, "yesterday_summary_group_ids");
      if (hour !== null && groups > 0) {
        occurrences.push({
          service: "ailytics",
          projectCode,
          cadence: "yesterday 24h summary",
          hour,
          sends: groups,
          certainty: "scheduled",
        });
      }
    }

    return { occurrences, ambient };
  },
};
