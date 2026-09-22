import { countIn, isEnabled } from "../helpers";
import type { Ambient, LoadProvider, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/**
 * Read from the lightning repo's `usecases/lightning/tick.js`.
 *
 * The Lambda is invoked once a minute and sends while a qualifying strike is
 * inside a project's ring. That is weather, not a schedule: there is no hour of
 * the day at which it is due, and the hours it is busiest are precisely the
 * ones this model cannot predict.
 *
 * So it contributes no bars at all. Smearing sixty possible sends an hour
 * across the day would swamp every real cadence in the chart with a number
 * that is wrong at every hour — and on the one afternoon it IS right, the
 * chart was not what anybody was looking at.
 */
export const lightningLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const ambient: Ambient[] = [];

    const alerts = countIn(config, "whatsapp_group_id");
    if (alerts > 0) {
      ambient.push({
        service: "lightning",
        projectCode,
        reason: "Every minute a qualifying strike is in range — storm-driven, so it has no hour",
        groups: alerts,
      });
    }

    // SMS forwarding is its own destination and its own trigger: an inbound
    // SMS relayed to a group, which nothing here can time either.
    if (config.enable_sms_lightning_alerts === true) {
      const sms = countIn(config, "sms_whatsapp_group_id");
      if (sms > 0) {
        ambient.push({
          service: "lightning",
          projectCode,
          reason: "Forwarded SMS, whenever one arrives",
          groups: sms,
        });
      }
    }

    return { occurrences: [], ambient };
  },
};
