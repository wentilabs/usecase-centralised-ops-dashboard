import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";

/** Scraping is scheduled outside the database; the row stores no cadence. */
export const vibrationScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    return config.enabled === true
      ? "scraped from the portal on an external schedule — the interval is not stored in this configuration"
      : "not scraped while the project is disabled — enable it, then the external schedule picks it up";
  },
  hasCadence(_config: ProjectConfigRow): boolean {
    return false;
  },
};
