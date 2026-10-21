import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";

/**
 * Service-owned capability pills for the project card.
 *
 * Vibration messages nobody on a schedule: it scrapes portals into the site's
 * own readings table. So the pills say where the site is and what the row's
 * `enabled` switch really does, which is not what the same word means on the
 * alert services.
 */
export function vibrationPills(config: ProjectConfigRow): Pill[] {
  const site = String(config.site_name ?? "").trim();
  return [
    { label: site || "no site name", on: true, ...(site ? {} : { tone: "warn" as const }) },
    { label: String(config.timezone ?? "").trim() || "no timezone", on: Boolean(config.timezone) },
    // `enabled` does not stop scraping: the scraper writes every source target
    // whose site row exists. Labelled for what it gates — the diagnostic
    // notification — so a project showing "off" is not read as "paused".
    { label: "diagnostic notification", on: config.enabled === true },
  ];
}
