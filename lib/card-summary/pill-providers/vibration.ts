import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";

/**
 * Service-owned capability pills for the project card.
 *
 * A site scrapes into its own readings table. Its WhatsApp report is invoked
 * manually, so it does not add a scheduled cadence pill.
 */
export function vibrationPills(config: ProjectConfigRow): Pill[] {
  const site = String(config.site_name ?? "").trim();
  return [
    { label: site || "no site name", on: true, ...(site ? {} : { tone: "warn" as const }) },
    { label: String(config.timezone ?? "").trim() || "no timezone", on: Boolean(config.timezone) },
    // The one switch on the row that does something: it gates scraping of the site's meters.
    { label: "scraping", on: config.enabled === true },
  ];
}
