import type { ProjectConfigRow } from "../services";

export type ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string;
  hasCadence(config: ProjectConfigRow): boolean;
};
