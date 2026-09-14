import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";

/** Service-owned card schedule and cadence semantics. */
export const ailyticsScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    return "Event-driven — fires when the CCTV bot posts.";
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return config.enabled !== false;
  },
};
