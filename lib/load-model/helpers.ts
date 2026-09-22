import { splitList } from "../card-summary/groups";
import type { ProjectConfigRow } from "../services";

/** Every hour of the day, 0–23. */
export const ALL_HOURS: number[] = Array.from({ length: 24 }, (_, hour) => hour);

/** The hour part of an `HHMM` column, or null when it is unset or malformed. */
export function hourOf(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{3,4}$/.test(raw)) return null;
  const hour = Number(raw.padStart(4, "0").slice(0, 2));
  return hour >= 0 && hour <= 23 ? hour : null;
}

/** An integer column's hour, or null. Some services store a bare hour. */
export function plainHour(value: unknown): number | null {
  const hour = Number(String(value ?? "").trim());
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * The hours an `HHMM`–`HHMM` window covers, inclusive of both ends.
 *
 * Inclusive because a window of `0700`–`1900` is a site that is working at
 * 19:00, and the cadence inside it fires on the hour. An unset or half-set
 * window is the whole day: that is what the services do — `isWithinCadenceWindow`
 * in the noise repo returns true when either end is missing — and it is the
 * case that matters, because most rows leave these blank.
 *
 * A window that wraps past midnight (`2200`–`0600`) is honoured rather than
 * treated as empty; night shifts exist.
 */
export function windowHours(start: unknown, end: unknown): number[] {
  const from = hourOf(start);
  const to = hourOf(end);
  if (from === null || to === null) return ALL_HOURS;
  if (from <= to) return ALL_HOURS.filter((hour) => hour >= from && hour <= to);
  return ALL_HOURS.filter((hour) => hour >= from || hour <= to);
}

/** The hours a bare start/end pair of integers covers, inclusive. */
export function plainWindowHours(start: unknown, end: unknown): number[] {
  const from = plainHour(start);
  const to = plainHour(end);
  if (from === null || to === null) return ALL_HOURS;
  if (from <= to) return ALL_HOURS.filter((hour) => hour >= from && hour <= to);
  return ALL_HOURS.filter((hour) => hour >= from || hour <= to);
}

/** How many chat ids one column holds. */
export function countIn(config: ProjectConfigRow, column: string): number {
  return splitList(config[column]).length;
}

/**
 * The first column in the chain that holds anything, as a count.
 *
 * The Issue Chaser summaries resolve their destination this way — a style's own
 * column, then the shared summary list, then the legacy list — and it is a
 * fallback rather than a union: once a style-specific column is set, the others
 * are not used. Adding them would double-count a project that has both.
 */
export function countFirst(config: ProjectConfigRow, columns: string[]): number {
  for (const column of columns) {
    const found = countIn(config, column);
    if (found > 0) return found;
  }
  return 0;
}

/**
 * The hours named by a `HH00,lookback;HH00,lookback` schedule column.
 *
 * Same grammar `reportSchedule` parses for the cards, read for the hour alone.
 * An unparseable entry contributes no hour, which matches the service: its
 * `parseHourlySchedule` collects errors and drops the entry rather than
 * guessing a time.
 */
export function scheduleHours(value: unknown): number[] {
  const hours = String(value ?? "")
    .split(";")
    .map((part) => /^(2[0-3]|[01]\d)00\s*,\s*\d+$/.exec(part.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]));
  return [...new Set(hours)].sort((a, b) => a - b);
}

/**
 * How many independent senders this WBGT project has.
 *
 * With `delivery_scope = "sensor"` — MBS only — each active sensor runs its own
 * cycle and posts to its own mapped group, so the project's traffic is per
 * sensor rather than per project. `sensor_delivery_groups` is that mapping, and
 * an incomplete one fails closed upstream, so its size is the sender count.
 */
export function wbgtSenders(config: ProjectConfigRow): number {
  if (String(config.delivery_scope ?? "").trim() !== "sensor") return 1;
  const mapping = config.sensor_delivery_groups;
  if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
    return Math.max(1, Object.keys(mapping as Record<string, unknown>).length);
  }
  if (typeof mapping === "string" && mapping.trim()) {
    try {
      const parsed = JSON.parse(mapping) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Math.max(1, Object.keys(parsed as Record<string, unknown>).length);
      }
    } catch {
      // A malformed mapping is one sender's worth rather than zero: the
      // project still sends, and pretending otherwise would understate it.
    }
  }
  return 1;
}

/** Whether the row is switched on at all. `enabled` defaults to true when absent. */
export function isEnabled(config: ProjectConfigRow): boolean {
  return config.enabled !== false;
}
