import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";

/**
 * Service-owned capability pills for the project card.
 *
 * Vibration messages nobody for a site: it scrapes portals into the site's own
 * readings table, and the site row is read by nothing that sends. So the pills say
 * only where the site is.
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
