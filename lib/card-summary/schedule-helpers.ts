import type { ProjectConfigRow, ServiceKey } from "../services";
import { splitList } from "./groups";

export function severityWindow(config: ProjectConfigRow, startColumn: string, endColumn: string): string {
  const clip = (value: unknown) => String(value ?? "").trim().slice(0, 5);
  const start = clip((config as Record<string, unknown>)[startColumn]);
  const end = clip((config as Record<string, unknown>)[endColumn]);
  if (!start && !end) return "round the clock";
  if (!start || !end) return "on a half-set window — nothing is due until both ends are set";
  return `within ${start}–${end}`;
}

export function formatHhmm(value: unknown): string {
  const raw = String(value ?? "");
  const padded = raw.padStart(4, "0");
  return /^\d{4}$/.test(padded) ? `${padded.slice(0, 2)}:${padded.slice(2)}` : raw || "—";
}

export function formatSgt(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function mutesSuffix(config: ProjectConfigRow, phrase = "muted"): string {
  const mutes: string[] = [];
  if (config.remove_sunday_notifications) mutes.push("Sundays");
  if (config.remove_ph_notifications) mutes.push("PH");
  return mutes.length ? ` — ${phrase} ${mutes.join(" + ")}` : "";
}

export function window(start: unknown, end: unknown): string {
  return start || end ? ` (${formatHhmm(start)}–${formatHhmm(end)})` : "";
}

export function isManualIngestion(service: ServiceKey, config: ProjectConfigRow): boolean {
  if (service !== "wbgt") return false;
  if (config.enabled === false) return false;
  // Scrape defaults to on, so only an explicit false means manual.
  if (config.enable_scrape !== false) return false;
  return (
    splitList(config.whatsapp_wbgt_source_chat_ids).length > 0 ||
    splitList(config.telegram_chat_ids).length > 0 ||
    // The signed external Telegram route (64d2145). It does NOT use
    // `telegram_chat_ids` — the parser registry in the service decides which
    // text belongs to which project — so a project fed entirely by it has both
    // chat lists empty and would have read as idle, which is the exact failure
    // this function exists to prevent.
    //
    // Sufficient, not necessary: the flag governs the outbound advisory and
    // readings are parsed and stored either way, so a project with it OFF may
    // still be fed this way and cannot be told apart here. On is a deliberate
    // act and means the project is working.
    config.enable_external_telegram_alerts === true
  );
}

export function reportSchedule(value: unknown): { times: string[]; lookback: number | null } {
  const entries = String(value ?? "")
    .split(";")
    .map((part) => /^(2[0-3]|[01]\d)00\s*,\s*(\d+)$/.exec(part.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match));
  if (!entries.length) return { times: [], lookback: null };
  const times = entries.map((match) => `${match[1]}:00`);
  const lookbacks = [...new Set(entries.map((match) => Number(match[2])))];
  // One number only when every run agrees; mixed lookbacks are reported per
  // entry by the editor, not summarised into a figure that is true of neither.
  return { times, lookback: lookbacks.length === 1 ? lookbacks[0] : null };
}

export function subconReports(config: ProjectConfigRow): string[] {
  if (config.enabled === false) return [];
  const reports: string[] = [];
  if (config.enable_activity_summary === true) reports.push("activity + manpower");
  if (config.enable_manpower_summary === true) reports.push("manpower + machines");
  return reports;
}

export function fiveMinCrossings(config: ProjectConfigRow): string {
  switch (String(config.five_min_alert_threshold ?? "").trim().toLowerCase()) {
    case "yellow":
      return "31/32/33°C";
    case "red":
      return "33°C";
    default:
      return "32/33°C";
  }
}
