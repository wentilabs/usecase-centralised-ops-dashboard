export type HealthSchedule = {
  key: string;
  route: string;
  name: string;
  method?: "GET" | "POST";
  hours: readonly number[];
  minutes: readonly number[];
  weekdays?: readonly number[];
  monthDays?: readonly number[];
};

/** A bad declaration must stop deployment instead of inventing missed runs. */
export function readHealthSchedules(health: unknown): readonly HealthSchedule[] {
  if (!health || typeof health !== "object") throw new Error("Missing health schedule declaration");
  const value = health as Record<string, unknown>;
  if (value.scheduleTimezone !== "UTC" || !Array.isArray(value.schedules) || !value.schedules.length) {
    throw new Error("Health schedules require a non-empty UTC declaration");
  }
  const keys = new Set<string>();
  const validNumbers = (list: unknown, min: number, max: number) =>
    Array.isArray(list) && list.length > 0 && list.every((item) => Number.isInteger(item) && item >= min && item <= max);
  for (const item of value.schedules) {
    if (!item || typeof item !== "object") throw new Error("Invalid health schedule");
    const schedule = item as Record<string, unknown>;
    if (typeof schedule.key !== "string" || !schedule.key.trim() || keys.has(schedule.key) ||
        typeof schedule.route !== "string" || !schedule.route.startsWith("/") ||
        typeof schedule.name !== "string" || !schedule.name.trim() ||
        (schedule.method !== undefined && schedule.method !== "GET" && schedule.method !== "POST") ||
        !validNumbers(schedule.hours, 0, 23) || !validNumbers(schedule.minutes, 0, 59) ||
        (schedule.weekdays !== undefined && !validNumbers(schedule.weekdays, 0, 6)) ||
        (schedule.monthDays !== undefined && !validNumbers(schedule.monthDays, 1, 31))) {
      throw new Error("Invalid health schedule fields or duplicate key");
    }
    keys.add(schedule.key);
  }
  return value.schedules as HealthSchedule[];
}
