import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";

/** Scraping is scheduled outside the database; the row stores no cadence. */
export const vibrationScheduleProvider: ScheduleProvider = {
  firesAt(_config: ProjectConfigRow): string {
    return "scraped from the portal on an external schedule — the interval is not stored in this configuration, and the enabled switch does not pause it";
  },
  hasCadence(_config: ProjectConfigRow): boolean {
    return false;
  },
};
