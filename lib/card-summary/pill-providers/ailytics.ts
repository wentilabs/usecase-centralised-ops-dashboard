import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";


/** Service-owned capability pills for the project card. */
export function ailyticsPills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  // Ailytics. Three pills were dropped as noise rather than signal:
  // `telegram source`, `sheet` and `whatsapp relay` were on for every
  // project, because a row without a Telegram chat, a spreadsheet or a
  // group is not a working project at all — they reported the setup being
  // complete, which is the normal case, instead of a choice someone made.
  // What is left is the two switches that actually differ between projects.
  return [
    // Outbound-only switch: PENDING alerts are stored and written to history
    // either way, so "off" does not mean nothing is happening.
    { label: "forward PENDING", on: on(config.forward_pending_to_whatsapp) },
    // The project-local Pending/open count that
    // POST /ailytics-safety/status-summary sends to whatsapp_group_ids.
    // Defaults to false and differs per project, which is what earns it a
    // pill: 2 of the 4 projects have it on.
    { label: "daily summary", on: on(config.status_summary_enabled) },
  ];
}
