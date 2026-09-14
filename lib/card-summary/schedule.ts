import type { ProjectConfigRow, ServiceKey } from "../services";
import { SCHEDULE_PROVIDERS } from "./schedule-providers";
import { isManualIngestion } from "./schedule-helpers";

export {
  fiveMinCrossings,
  formatHhmm,
  formatSgt,
  isManualIngestion,
  reportSchedule,
  subconReports,
} from "./schedule-helpers";

export function firesAt(service: ServiceKey, config: ProjectConfigRow): string {
  return SCHEDULE_PROVIDERS[service].firesAt(config);
}

export function hasCadence(service: ServiceKey, config: ProjectConfigRow): boolean {
  return SCHEDULE_PROVIDERS[service].hasCadence(config);
}

export type CardEmphasis = "active" | "manual" | "idle";

export function cardEmphasis(service: ServiceKey, config: ProjectConfigRow): CardEmphasis {
  if (hasCadence(service, config)) return "active";
  if (isManualIngestion(service, config)) return "manual";
  return "idle";
}

export function emphasisRank(service: ServiceKey, config: ProjectConfigRow): number {
  const order: Record<CardEmphasis, number> = { active: 2, manual: 1, idle: 0 };
  return order[cardEmphasis(service, config)];
}
