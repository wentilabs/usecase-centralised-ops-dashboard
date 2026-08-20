import { describeSelection, includesEveryMeter } from "./meter-selection";
import type { ProjectConfigRow, ServiceKey } from "./services";

/** Noise repo's quirky literal column name. */
export const ASSESS_COL = 'assessment_readings_mm_array("35,45,55")';

export function splitList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Which column(s) hold a service's WhatsApp group ids, and what each one is for.
 *
 * Every alert service keeps its groups in exactly one column, so a single entry
 * is equivalent to the old `?? ` fallback chain. Subcon is the first service
 * with several group columns that mean different things — showing them as one
 * undifferentiated list would lose that, hence the roles.
 */
const GROUP_COLUMNS: Record<ServiceKey, { column: string; role?: string }[]> = {
  wbgt: [{ column: "whatsapp_group_id" }],
  noise: [{ column: "whatsapp_group_id" }],
  haze: [{ column: "wa_group_ids" }],
  lightning: [{ column: "whatsapp_group_id" }],
  ailytics: [{ column: "whatsapp_group_ids" }],
  subcon: [
    { column: "manpower_activity_outbound_group_id", role: "manpower" },
    { column: "housekeeping_outbound_group_id", role: "housekeeping" },
    { column: "source_group_ids", role: "inbound" },
  ],
};

export type DeliveryGroup = { chatId: string; role?: string };

/**
 * The groups a project talks to, de-duplicated. One group commonly serves two
 * roles (the TEST project uses one chat for both reports), so roles are merged
 * onto a single entry rather than repeating the chat id — which would also
 * collide as a React key.
 */
export function deliveryGroups(service: ServiceKey, config: ProjectConfigRow): DeliveryGroup[] {
  const roles = new Map<string, string[]>();
  for (const { column, role } of GROUP_COLUMNS[service] ?? []) {
    for (const chatId of splitList(config[column])) {
      const existing = roles.get(chatId) ?? [];
      if (role && !existing.includes(role)) existing.push(role);
      roles.set(chatId, existing);
    }
  }
  return [...roles].map(([chatId, list]) => ({
    chatId,
    role: list.length ? list.join(" + ") : undefined,
  }));
}

/**
 * Every column, across every service, that stores WhatsApp chat ids: the
 * delivery columns above, plus the ones that carry chat ids for some purpose
 * other than delivery (mentions, expiry alerts, photo ingestion).
 *
 * Derived rather than hand-listed so a new service's delivery columns are
 * picked up automatically — this list decides which ids get a name resolved,
 * and a missing column means raw ids on the cards.
 */
export const CHAT_ID_COLUMNS: string[] = [
  ...new Set([
    ...Object.values(GROUP_COLUMNS).flatMap((entries) => entries.map((entry) => entry.column)),
    "alert_whatsapp_gid",
    "poc_alert_wa_groups",
    "whatsapp_wbgt_source_chat_ids",
  ]),
];

/** Group ids referenced by any of those columns, across the rows given. */
export function chatIdsIn(rows: ProjectConfigRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const column of CHAT_ID_COLUMNS) {
      for (const id of splitList(row[column])) {
        if (id.endsWith("@g.us")) ids.add(id);
      }
    }
  }
  return [...ids];
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
    if (!parts.length) {
      return isManualIngestion(service, config)
        ? "Manual photo ingestion — readings arrive as photos; no scheduled message"
        : "No cadences enabled";
    }
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
    const gate = config.alert_only_when_at_least
      ? ` — only when PSI ≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
      : "";
    return `hourly advisory during ${hours}${gate}${mutesSuffix(config)}`;
  }

  if (service === "lightning") {
    const hours =
      config.working_hours_start_hhmm || config.working_hours_end_hhmm
        ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
        : "all day";
    const scope = config.amber_enabled === false ? "red-only" : "red + amber";
    return `${scope} — every tick while a qualifying strike is in range, working hours ${hours}${mutesSuffix(config)}`;
  }

  if (service === "subcon") {
    const parts: string[] = [];
    // enable_manpower and enable_housekeeping default to true in Postgres, so
    // only an explicit false turns them off.
    if (config.enable_manpower !== false) parts.push("morning activity + manpower summary");
    if (config.enable_housekeeping !== false) parts.push("end-of-day housekeeping report");
    if (config.enable_water_parade) {
      parts.push("Water Parade reminders at the next two :00/:30 after a non-green hourly WBGT reading");
    }
    if (!parts.length) return "No usecases enabled";
    let line = `Event-driven on forwarded WhatsApp — ${parts.join(" · ")}`;
    // The distinction the service is emphatic about: `enabled` gates outbound
    // only, so a muted project is still classifying and writing sheets.
    if (config.enabled === false) line += " — outbound muted, still classifying and writing sheets";
    return line;
  }

  return "Event-driven — fires when the CCTV bot posts.";
}

/**
 * `on` means the switch is on; an off pill renders struck through. `tone: "warn"`
 * is for a state that is neither — active, but worth noticing rather than
 * celebrating, so it must not be drawn as a green tick or as a dead switch.
 */
export type Pill = { label: string; on: boolean; tone?: "warn" };

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
        // Only when a filter is actually set. Blank is the norm on every
        // project, so a pill saying so would be noise on 30 cards; a filter is
        // the notable state, and it is a caution rather than a feature being on.
        ...(includesEveryMeter(config.noise_meters_included)
          ? []
          : [
              {
                label: describeSelection(config.noise_meters_included, null),
                on: true,
                tone: "warn" as const,
              },
            ]),
      ];
    case "haze":
      return [
        { label: String(config.nea_region ?? "no region"), on: on(config.nea_region) },
        {
          label: config.alert_only_when_at_least
            ? `≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
            : "every hour",
          on: on(config.alert_only_when_at_least),
        },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
        { label: "POC mentions", on: on(config.enable_poc_mentions) },
        { label: `${String(config.advisory_format ?? "default")} format`, on: config.advisory_format === "wohhup" },
      ];
    case "lightning":
      return [
        { label: `red ${config.red_radius_m ?? "?"}m`, on: on(config.red_radius_m) },
        {
          label: config.amber_enabled === false ? "amber off" : `amber ${config.amber_radius_m ?? "?"}m`,
          on: config.amber_enabled !== false && on(config.amber_radius_m),
        },
        { label: `v${config.config_version ?? 1}`, on: true },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
        { label: "🔴 POC mentions", on: on(config.enable_red_band_poc_mentions) },
      ];
    case "subcon":
      return [
        { label: "manpower & activity", on: config.enable_manpower !== false },
        { label: "housekeeping", on: config.enable_housekeeping !== false },
        { label: "Water Parade", on: on(config.enable_water_parade) },
        { label: "outbound WhatsApp", on: config.enabled !== false },
        { label: "WBGT sheet", on: on(config.wbgt_google_sheet_id) },
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
export function autoLinks(service: ServiceKey, config: ProjectConfigRow): { label: string; href: string }[] {
  const sheet = (id: unknown) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(String(id))}/edit`;
  const links: { label: string; href: string }[] = [];
  if (config.monthly_sheet_id) links.push({ label: "📗 Monthly sheet", href: sheet(config.monthly_sheet_id) });
  if (config.google_sheet_id) links.push({ label: "📗 Analysis sheet", href: sheet(config.google_sheet_id) });
  if (config.spreadsheet_id) {
    // Same column, different documents: ailytics keeps its safety log there,
    // subcon its manpower workbook.
    links.push({
      label: service === "subcon" ? "📗 Manpower sheet" : "📗 Safety sheet",
      href: sheet(config.spreadsheet_id),
    });
  }
  if (config.wbgt_google_sheet_id) {
    links.push({ label: "📗 WBGT sheet (Water Parade)", href: sheet(config.wbgt_google_sheet_id) });
  }
  if (config.latitude && config.longitude) {
    links.push({
      label: "📍 Map",
      href: `https://www.google.com/maps?q=${encodeURIComponent(`${config.latitude},${config.longitude}`)}`,
    });
  }
  return links;
}

/**
 * A WBGT project fed by photos rather than by the CloudLynx scraper.
 *
 * These have every cadence off, so the old binary "has a cadence?" test filed
 * them with the idle projects — greyed out and sunk to the bottom — even though
 * they are live sites whose readings arrive by hand. The three conditions are
 * the ones that together mean "manual": the project is on, the scraper is off,
 * and there is somewhere for photos to come from.
 */
export function isManualIngestion(service: ServiceKey, config: ProjectConfigRow): boolean {
  if (service !== "wbgt") return false;
  if (config.enabled === false) return false;
  // Scrape defaults to on, so only an explicit false means manual.
  if (config.enable_scrape !== false) return false;
  return (
    splitList(config.whatsapp_wbgt_source_chat_ids).length > 0 || splitList(config.telegram_chat_ids).length > 0
  );
}

/**
 * How prominent a card should be. Three states, not two: a manual project is
 * working, so it must not look like an idle one, but it has no schedule either.
 */
export type CardEmphasis = "active" | "manual" | "idle";

export function cardEmphasis(service: ServiceKey, config: ProjectConfigRow): CardEmphasis {
  if (hasCadence(service, config)) return "active";
  if (isManualIngestion(service, config)) return "manual";
  return "idle";
}

/** Sort weight: scheduled first, then manual, then idle. */
export function emphasisRank(service: ServiceKey, config: ProjectConfigRow): number {
  const order: Record<CardEmphasis, number> = { active: 2, manual: 1, idle: 0 };
  return order[cardEmphasis(service, config)];
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
  if (service === "subcon") {
    // Not gated on `enabled`: outbound can be muted while the intake, the
    // classification and the Sheet writes all keep running.
    return Boolean(
      config.enable_manpower !== false || config.enable_housekeeping !== false || config.enable_water_parade,
    );
  }
  return config.enabled !== false;
}
