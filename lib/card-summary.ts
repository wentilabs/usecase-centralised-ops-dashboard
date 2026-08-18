import type { ProjectConfigRow, ServiceKey } from "./services";

/** Noise repo's quirky literal column name. */
export const ASSESS_COL = 'assessment_readings_mm_array("35,45,55")';

export function splitList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function mutesSuffix(config: ProjectConfigRow): string {
  const mutes: string[] = [];
  if (config.remove_sunday_notifications) mutes.push("Sundays");
  if (config.remove_ph_notifications) mutes.push("PH");
  return mutes.length ? ` — muted ${mutes.join(" + ")}` : "";
}

function window(start: unknown, end: unknown): string {
  return start || end ? ` (${formatHhmm(start)}–${formatHhmm(end)})` : "";
}

/** One line describing when a project's messages actually fire. */
export function firesAt(service: ServiceKey, config: ProjectConfigRow): string {
  if (service === "wbgt") {
    const parts: string[] = [];
    if (config.enable_hourly) parts.push(":00 hourly");
    if (config.enable_intermittent_reports) {
      parts.push(
        String(config.intermittent_reports_formatter ?? "red15").toLowerCase() === "red30"
          ? ":30 if High"
          : ":30 if Moderate+, :15/:45 if High",
      );
    }
    if (config.enable_5min_alerts) parts.push("5-min on 32/33°C crossings");
    if (!parts.length) return "No cadences enabled";
    let line = `${parts.join(" · ")} — site hours ${config.site_hours_start}:00–${config.site_hours_end}:00`;
    if (config.skip_lunch_hour) line += ", skips 12:00";
    return line + mutesSuffix(config).replace(" — muted", ", muted");
  }

  if (service === "noise") {
    const parts: string[] = [];
    if (config.enable_5min) parts.push(`5-min${window(config.five_min_start_hhmm, config.five_min_end_hhmm)}`);
    if (config.enable_half_hourly) {
      const marks = String(config[ASSESS_COL] ?? "30")
        .split(",")
        .map((m) => m.trim().padStart(2, "0"))
        .join(" :");
      parts.push(`half-hourly @ :${marks}${window(config.half_hourly_start_hhmm, config.half_hourly_end_hhmm)}`);
    }
    if (config.enable_hourly) parts.push(`hourly${window(config.hourly_start_hhmm, config.hourly_end_hhmm)}`);
    if (config.enable_three_hour_summary) parts.push("3-hr summary");
    if (config.enable_morning_summary) {
      parts.push(
        `morning${config.morning_summary_start_hhmm ? ` @ ${formatHhmm(config.morning_summary_start_hhmm)}` : ""}`,
      );
    }
    if (config.enable_sunday_leq12h_hourly) parts.push("Sunday Leq12h hourly");
    if (config.enable_7am_7pm_leq12hr_table) parts.push("Leq12hr table @ 07:00/19:00");
    if (!parts.length) return "No cadences enabled";
    return parts.join(" · ") + mutesSuffix(config);
  }

  if (service === "haze") {
    const hours =
      config.working_hours_start_hhmm || config.working_hours_end_hhmm
        ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
        : "all day";
    return `hourly advisory during ${hours}${mutesSuffix(config)}`;
  }

  if (service === "lightning") {
    const hours =
      config.working_hours_start_hhmm || config.working_hours_end_hhmm
        ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
        : "all day";
    return `every tick while a qualifying strike is in range — working hours ${hours}${mutesSuffix(config)}`;
  }

  return "Event-driven — fires when the CCTV bot posts.";
}

export type Pill = { label: string; on: boolean };

/** The at-a-glance switches for a project, per service. */
export function pillsFor(service: ServiceKey, config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  switch (service) {
    case "wbgt":
      return [
        { label: "hourly", on: on(config.enable_hourly) },
        { label: "intermittent", on: on(config.enable_intermittent_reports) },
        { label: "5-min alerts", on: on(config.enable_5min_alerts) },
        { label: "scrape", on: config.enable_scrape !== false },
        { label: "skip lunch", on: on(config.skip_lunch_hour) },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
        { label: "POC mentions", on: on(config.enable_red_band_poc_mentions) },
      ];
    case "noise":
      return [
        { label: "5-min", on: on(config.enable_5min) },
        { label: "half-hourly", on: on(config.enable_half_hourly) },
        { label: "hourly", on: on(config.enable_hourly) },
        { label: "3-hr summary", on: on(config.enable_three_hour_summary) },
        { label: "morning summary", on: on(config.enable_morning_summary) },
        { label: "Sunday Leq12h", on: on(config.enable_sunday_leq12h_hourly) },
        { label: "Leq12hr table", on: on(config.enable_7am_7pm_leq12hr_table) },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
        { label: "expiry alerts", on: on(config.allow_expiry_alert) },
      ];
    case "haze":
      return [
        { label: String(config.nea_region ?? "no region"), on: on(config.nea_region) },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
      ];
    case "lightning":
      return [
        { label: `red ${config.red_radius_m ?? "?"}m`, on: on(config.red_radius_m) },
        { label: `amber ${config.amber_radius_m ?? "?"}m`, on: on(config.amber_radius_m) },
        { label: `v${config.config_version ?? 1}`, on: true },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
      ];
    default:
      return [
        { label: "telegram source", on: on(config.telegram_chat_id) },
        { label: "sheet", on: on(config.spreadsheet_id) },
        { label: "whatsapp relay", on: on(config.whatsapp_group_ids) },
      ];
  }
}

/** Links derivable from the row itself. */
export function autoLinks(config: ProjectConfigRow): { label: string; href: string }[] {
  const sheet = (id: unknown) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(String(id))}/edit`;
  const links: { label: string; href: string }[] = [];
  if (config.monthly_sheet_id) links.push({ label: "📗 Monthly sheet", href: sheet(config.monthly_sheet_id) });
  if (config.google_sheet_id) links.push({ label: "📗 Analysis sheet", href: sheet(config.google_sheet_id) });
  if (config.spreadsheet_id) links.push({ label: "📗 Safety sheet", href: sheet(config.spreadsheet_id) });
  if (config.latitude && config.longitude) {
    links.push({
      label: "📍 Map",
      href: `https://www.google.com/maps?q=${encodeURIComponent(`${config.latitude},${config.longitude}`)}`,
    });
  }
  return links;
}

/** Cards with nothing scheduled sink to the bottom of the grid. */
export function hasCadence(service: ServiceKey, config: ProjectConfigRow): boolean {
  if (service === "wbgt") {
    return Boolean(config.enable_hourly || config.enable_intermittent_reports || config.enable_5min_alerts);
  }
  if (service === "noise") {
    return Boolean(
      config.enable_5min ||
        config.enable_half_hourly ||
        config.enable_hourly ||
        config.enable_three_hour_summary ||
        config.enable_morning_summary ||
        config.enable_sunday_leq12h_hourly ||
        config.enable_7am_7pm_leq12hr_table,
    );
  }
  return config.enabled !== false;
}
