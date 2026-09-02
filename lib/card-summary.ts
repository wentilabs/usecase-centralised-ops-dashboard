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
const GROUP_COLUMNS: Record<ServiceKey, { column: string; role?: string; single?: boolean }[]> = {
  wbgt: [
    { column: "whatsapp_group_id" },
    // `single`: the service reads this column with
    // `String(config.water_parade_outbound_group_id || "").trim()` and posts it
    // as one `chatId` — no comma split, unlike every other group column. So a
    // second id in there is not a second recipient; it corrupts the chat id.
    // Marked here so the card can say which group actually receives a reminder.
    { column: "water_parade_outbound_group_id", role: "water parade", single: true },
  ],
  noise: [
    { column: "whatsapp_group_id" },
    // Opt-in second destination, and only for messages carrying a 🟠 or 🔴 —
    // the role says so, because a chip that just read as another recipient
    // would imply these groups get the whole half-hourly stream.
    { column: "exceedance_half_hourly_wa_groups", role: "half-hourly warnings only" },
  ],
  haze: [{ column: "wa_group_ids" }],
  lightning: [{ column: "whatsapp_group_id" }],
  ailytics: [{ column: "whatsapp_group_ids" }],
  // Two directions again: safety_group_ids is where messages come FROM, and the
  // morning report goes TO its own group. Labelled so the card cannot imply that
  // an inbound group receives anything.
  subcon: [
    { column: "manpower_activity_outbound_group_id", role: "morning report" },
    { column: "safety_group_ids", role: "inbound" },
  ],
  issueChaser: [{ column: "whatsapp_group_ids" }],
};

export type DeliveryGroup = { chatId: string; role?: string };

/**
 * The groups a project talks to, de-duplicated. One group commonly serves two
 * roles (the TEST project uses one chat for both reports), so roles are merged
 * onto a single entry rather than repeating the chat id — which would also
 * collide as a React key.
 */
/**
 * Which columns of a service hold chat ids, and what each is for.
 *
 * Exposed so the bulk-edit path in `chat-scope.ts` reads the same registry the
 * cards render delivery chips from. A second list of group columns would drift,
 * and the way it would drift is by missing one — leaving a group in place on a
 * column nobody remembered.
 */
export function groupColumnsFor(service: ServiceKey): { column: string; role?: string; single?: boolean }[] {
  return GROUP_COLUMNS[service] ?? [];
}

export function deliveryGroups(service: ServiceKey, config: ProjectConfigRow): DeliveryGroup[] {
  const roles = new Map<string, string[]>();
  for (const { column, role, single } of GROUP_COLUMNS[service] ?? []) {
    const ids = splitList(config[column]);
    for (const [index, chatId] of ids.entries()) {
      const existing = roles.get(chatId) ?? [];
      // A `single` column only ever delivers to its first id. Anything after it
      // is stored, shown, and never sent to — saying otherwise would present a
      // misconfiguration as a capability.
      const effective = single && index > 0 ? `${role} — ignored, the service sends to the first id only` : role;
      if (effective && !existing.includes(effective)) existing.push(effective);
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
    if (config.enable_5min_alerts) parts.push(`5-min on ${fiveMinCrossings(config)} crossings`);
    if (config.water_parade_enabled) {
      // The cooldown changes how often a site is asked, which is the part an
      // operator is answering questions about — worth a clause, not just a pill.
      parts.push(
        config.water_parade_cooldown_enabled
          // Phrased as the lookback the code performs — `cooldownHourBands`
          // checks the two preceding hour bands of the same day — rather than
          // "one per 3 bands", which is the same rule stated as arithmetic and
          // reads as a contradiction next to the "cooldown 2h" pill.
          ? "Water Parade reminders, skipped if a cycle ran in the previous 2 hour bands"
          : "Water Parade reminders",
      );
    }
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
      const relay = config.half_hourly_send_if_exceed ? ", warnings relayed" : "";
      parts.push(
        `half-hourly @ :${marks}${window(config.half_hourly_start_hhmm, config.half_hourly_end_hhmm)}${relay}`,
      );
    }
    if (config.enable_hourly) parts.push(`hourly${window(config.hourly_start_hhmm, config.hourly_end_hhmm)}`);
    if (config.enable_three_hour_summary) parts.push("3-hr summary");
    if (config.enable_morning_summary) {
      parts.push(
        `morning${config.morning_summary_start_hhmm ? ` @ ${formatHhmm(config.morning_summary_start_hhmm)}` : ""}`,
      );
    }
    // Fixed 07:00–19:00 closeout, scheduled at 19:00 — no configurable start.
    if (config.enable_evening_summary) parts.push("evening 7am–7pm closeout @ 19:00");
    if (config.enable_sunday_leq12h_hourly) parts.push("Sunday Leq12h hourly");
    if (config.enable_7am_7pm_leq12hr_table) parts.push("Leq12hr table @ 07:00/19:00");
    if (!parts.length) return "No cadences enabled";
    return parts.join(" · ") + mutesSuffix(config);
  }

  if (service === "haze") {
    // The service treats a half-configured window as no window at all, so one
    // end on its own must not be reported here as a range.
    const bothEnds = Boolean(config.working_hours_start_hhmm && config.working_hours_end_hhmm);
    const hours = bothEnds
      ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
      : "all day";
    const gate = config.alert_only_when_at_least
      ? ` — only when PSI ≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
      : "";
    if (config.four_hourly) {
      // The override sends at those four hours whatever the band AND outside the
      // working-hours window, which is why the 20:00 slot fires for a project
      // whose window closes at 19:00. Every other hour follows the ordinary
      // gates, so the floor is still quoted — dropping it would imply the
      // whole day ignores it.
      return `hourly advisory during ${hours}${gate}, plus a guaranteed send at 08:00, 12:00, 16:00 and 20:00 whatever the band and outside those hours — no daily kickoff${mutesSuffix(
        config,
      )}`;
    }
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
    // Three routes, not two: /housekeeping-intake accepts forwarded messages,
    // /daily-activity-summary sends the activity + manpower message, and
    // /daily-manpower-summary sends the plain per-company headcount. `enabled`
    // governs the two reports and not intake, which runs either way.
    //
    // Naming both reports matters because they read different tabs and answer
    // different questions, and until the per-report columns exist one switch
    // sends both — so a card saying "morning report" left an operator unable to
    // tell which of the two a site actually receives.
    const parts: string[] = [];
    if (config.enable_housekeeping !== false) {
      // Supabase, not a sheet tab. The service stopped writing the Daily
      // Activity projection when Supabase became canonical, so naming the tab
      // here would send someone to a document that no longer updates.
      parts.push("housekeeping events recorded in Supabase");
    }
    // Each report is an explicit opt-in in the service, so a project can be
    // enabled and still send nothing.
    const reports = subconReports(config);
    // Not joined with "+": each name already contains one, and "activity +
    // manpower + manpower + machines" reads as one report with four parts.
    if (reports.length === 2) {
      parts.push("morning reports: activity + manpower, and manpower + machines");
    } else if (reports.length === 1) {
      parts.push(`only the ${reports[0]} morning report`);
    }
    if (!parts.length) return "Nothing is accepted and nothing is sent";
    let line = `Event-driven on forwarded WhatsApp — ${parts.join(" · ")}`;
    // A report with no destination is the quiet failure worth surfacing.
    if (reports.length && !String(config.manpower_activity_outbound_group_id ?? "").trim()) {
      line += " — no report group set, so nothing is delivered";
    }
    return line;
  }
  if (service === "issueChaser") {
    const parts: string[] = [];
    if (config.severity_cadence_chaser_enabled) {
      // The windows are configuration now, not constants. This line used to say
      // "P2 daily and P3 weekly within 07:00–19:00" and that became wrong the
      // moment the columns landed: `configuredWindow` returns null when neither
      // end is set and `isInSendWindow` then returns true, so an unset window is
      // round the clock — the opposite of the old fixed hours. lib/cadence.js
      // still exports DAY_WINDOW_START/END but no longer reads them.
      parts.push(
        `P1 every 3h ${severityWindow(config, "severity_p1_window_start", "severity_p1_window_end")}` +
          `, P2 daily and P3 weekly ${severityWindow(config, "severity_p2_p3_window_start", "severity_p2_p3_window_end")}`,
      );
    }
    if (config.same_day_open_snapshot_enabled) {
      const lookback = Number(config.include_days_before_snapshot ?? 0);
      parts.push(
        "same-day open snapshot at 09:00 and 21:00" +
          (Number.isFinite(lookback) && lookback > 0
            ? ` covering the previous ${lookback} day${lookback === 1 ? "" : "s"} too`
            : ""),
      );
    }

    // Said separately from the chasers, not folded into them. A summary chases
    // nobody and never uses an issue's origin group — it carries the opposite
    // routing, so sharing the chasers' suffix would state the wrong destination.
    const summaries: string[] = [];
    if (config.daily_safety_summary_enabled) summaries.push("past-days safety summary");
    if (config.daily_safety_company_summary_enabled) {
      summaries.push(summaries.length ? "the same split by company" : "past-days summary by company");
    }

    if (!parts.length && !summaries.length) return "No chaser style enabled — nothing is sent";

    const clauses: string[] = [];
    if (parts.length) {
      // Worth stating: the destination is usually not a configured group at all.
      clauses.push(
        `${parts.join(" · ")} — ${
          config.send_to_originating_groups === false
            ? "replies to the configured groups"
            : "replies in each issue's originating group"
        }`,
      );
    }
    if (summaries.length) {
      const days = Number(config.summary_days ?? 5);
      const span = Number.isFinite(days) && days > 0 ? days : 5;
      clauses.push(
        `${summaries.join(" and ")} at 08:00 over ${span} day${span === 1 ? "" : "s"}` +
          ", always to the configured groups",
      );
    }
    return `Reads the Safety workbook — ${clauses.join("; ")}`;
  }

  return "Event-driven — fires when the CCTV bot posts.";
}

/**
 * `on` means the switch is on; an off pill renders struck through.
 *
 * A `tone` marks a pill that is neither of those:
 * - `warn` — active, but worth noticing rather than celebrating (a meter filter).
 * - `info` — a capability the project has, called out so it is not lost among
 *   the cadence switches.
 *
 * Toned pills are rendered before the rest, and survive the mobile cap.
 */
export type Pill = { label: string; on: boolean; tone?: "warn" | "info" };

/** The at-a-glance switches for a project, per service. */
/**
 * Whether POC mentions are resolved from the Manpower sheet rather than a list.
 *
 * `poc_phone_numbers` accepts either digits or the single exact value
 * `manpower-sheet`. Mixing them is not a partial success: the service returns NO
 * numbers, so nobody is mentioned and nothing errors. Detected here so the card
 * can distinguish "reads the sheet daily" from "someone left this blank".
 */
export function usesManpowerSheetPocs(config: ProjectConfigRow): boolean {
  return String(config.poc_phone_numbers ?? "").trim().toLowerCase() === "manpower-sheet";
}

export function pillsFor(service: ServiceKey, config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  switch (service) {
    case "wbgt":
      return [
        ...(config.water_parade_enabled
          ? [
              { label: "💧 Water Parade", on: true, tone: "info" as const },
              // Only shown where Water Parade runs: on a project without it the
              // flag is inert, and a struck-through pill on 20 cards would be
              // noise. Lit or unlit here is a real difference in how often a
              // site is asked.
              // Blue, like 💧 Water Parade above it: tone marks the feature
              // these pills belong to, and all three are Water Parade only.
              { label: "cooldown 2h", on: on(config.water_parade_cooldown_enabled), tone: "info" as const },
            ]
          : []),
        // A second id in `water_parade_outbound_group_id` is not a second
        // recipient: the reminder path posts the raw column value as one
        // `chatId`, so the comma goes with it and the send is malformed. The
        // service returns no error a reader would notice — the value is
        // non-empty, so it never reports missing delivery config.
        ...(splitList(config.water_parade_outbound_group_id).length > 1
          ? [{ label: "⚠ 2+ water parade groups", on: true, tone: "warn" as const }]
          : []),
        { label: "hourly", on: on(config.enable_hourly) },
        { label: "intermittent", on: on(config.enable_intermittent_reports) },
        { label: "5-min alerts", on: on(config.enable_5min_alerts) },
        // Only when it is not the default. A pill saying "min orange" on every
        // card would be noise — the whole point is to spot the two projects
        // that differ. Blue for the same reason as `cooldown 2h`: it modifies a
        // feature rather than switching one on.
        ...(config.enable_5min_alerts &&
        ["yellow", "red"].includes(String(config.five_min_alert_threshold ?? "").trim().toLowerCase())
          ? [
              {
                label: `min ${String(config.five_min_alert_threshold).toLowerCase()} ${
                  String(config.five_min_alert_threshold).toLowerCase() === "yellow" ? "31" : "33"
                }°C`,
                on: true,
                tone: "info" as const,
              },
            ]
          : []),
        { label: "scrape", on: config.enable_scrape !== false },
        { label: "skip lunch", on: on(config.skip_lunch_hour) },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
        // Where the numbers come from matters: the sentinel resolves them from
        // the Manpower sheet each day, so an empty list is not a misconfiguration.
        ...(usesManpowerSheetPocs(config)
          ? [{ label: "🔴 POC from sheet", on: true, tone: "info" as const }]
          : [{ label: "POC mentions", on: on(config.enable_red_band_poc_mentions) }]),
        // Only where the Manpower tab is actually read — Water Parade, or POC
        // numbers resolved from the sheet. Elsewhere the flag is inert and a
        // pill on every card would say nothing. Lit is the default (Woh Hup
        // filtered out as the main contractor); struck means a project counts
        // it as a participant, which today is MBS alone.
        ...(config.water_parade_enabled || usesManpowerSheetPocs(config)
          ? [
              {
                label: "excl. Woh Hup",
                on: config.exclude_wohhup_from_manpower !== false,
                tone: "info" as const,
              },
            ]
          : []),
      ];
    case "noise":
      return [
        { label: "5-min", on: on(config.enable_5min) },
        { label: "half-hourly", on: on(config.enable_half_hourly) },
        { label: "hourly", on: on(config.enable_hourly) },
        { label: "3-hr summary", on: on(config.enable_three_hour_summary) },
        { label: "morning summary", on: on(config.enable_morning_summary) },
        { label: "evening summary", on: on(config.enable_evening_summary) },
        { label: "Sunday Leq12h", on: on(config.enable_sunday_leq12h_hourly) },
        { label: "Leq12hr table", on: on(config.enable_7am_7pm_leq12hr_table) },
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
        { label: "expiry alerts", on: on(config.allow_expiry_alert) },
        // Shown only when set. It is opt-in and off nearly everywhere, so a
        // struck-through pill would take a slot on every card to say nothing —
        // the same reasoning as the meter filter below. Info-toned because it
        // is a routing choice, not a cadence.
        ...(config.half_hourly_send_if_exceed
          ? [{ label: "warning relay", on: true, tone: "info" as const }]
          : []),
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
        // No cadence pill. Every haze project runs hourly — there is no second
        // cadence to distinguish it from — so a pill reading "hourly" would be
        // true of all 25 and tell a reader nothing. It said "4-hourly" vs
        // "hourly" while `four_hourly` meant "only at those four hours"; it now
        // means an override on top of the hourly run (INV-HAZE-01).
        {
          label: "🕓 4-hourly override",
          on: on(config.four_hourly),
        },
        // The floor still governs every other hour, so it is reported as stored
        // whether or not the override is on. Saying "every band" here was right
        // when four-hourly was the whole cadence and is wrong now: it would
        // claim the 09:00 and 10:00 sends ignore the gate too.
        {
          label: config.alert_only_when_at_least
            ? `≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
            : "every band",
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
        { label: "housekeeping intake", on: config.enable_housekeeping !== false },
        // One pill per report rather than a single "morning report". They read
        // different tabs and answer different questions, and a project can end
        // up with one and not the other once the columns exist.
        {
          label: "activity + manpower",
          on: subconReports(config).includes("activity + manpower"),
        },
        {
          label: "manpower + machines",
          on: subconReports(config).includes("manpower + machines"),
        },
        { label: "manpower workbook", on: on(config.spreadsheet_id) },
        // Same wording as WBGT's pill and a different filter behind it: this one
        // shapes the housekeeping roster and the manpower summary. Info-toned
        // because it is a scoping choice, not a cadence, and shown always rather
        // than only when off — a roster that silently includes or excludes the
        // main contractor changes every headcount on the report.
        {
          label: "excl. Woh Hup",
          on: config.exclude_wohhup_from_manpower !== false,
          tone: "info" as const,
        },
        {
          // What it answers: does anything reach this project at all? Only
          // `safety_group_ids` answers it. Project routing is group-based; the
          // listener middleware owns any client-level gating upstream.
          //
          // So this pill is lit by the group list alone. A project with a
          // no groups is not routed, and showing it as configured would hide
          // exactly the mistake worth seeing.
          label: "message source",
          on: on(config.safety_group_ids),
        },
      ];
    case "issueChaser":
      return [
        // A style cannot be on unless `enabled` is, so an unlit style on an
        // enabled project means nobody switched it on.
        { label: "severity cadence", on: on(config.severity_cadence_chaser_enabled) },
        { label: "same-day snapshot", on: on(config.same_day_open_snapshot_enabled) },
        // "P1 escalation" was dropped here with the column: the digest is
        // retired in the service, so an unlit pill for it only sent people
        // looking for a switch that no longer exists.
        // Reports rather than chasers, and blue for it — the same reasoning as
        // the WBGT Water Parade pills: tone separates "a different kind of
        // thing" from "another switch in the same row".
        ...(config.daily_safety_summary_enabled
          ? [{ label: "daily summary", on: true, tone: "info" as const }]
          : []),
        ...(config.daily_safety_company_summary_enabled
          ? [{ label: "summary by company", on: true, tone: "info" as const }]
          : []),
        { label: "reply in origin group", on: config.send_to_originating_groups !== false },
        // "origin required", "images" and "PIC mentions" were dropped here when
        // their columns were retired from the service (412256d). Each is now
        // unconditional behaviour, and a pill for a setting that no longer exists
        // is worse than no pill: it invites someone to go looking for a switch.
      ];
    default:
      // Ailytics. Three pills were dropped as noise rather than signal:
      // `telegram source`, `sheet` and `whatsapp relay` were on for every
      // project, because a row without a Telegram chat, a spreadsheet or a
      // group is not a working project at all — they reported the setup being
      // complete, which is the normal case, instead of a choice someone made.
      // What is left is the two switches that actually differ between projects.
      return [
        // Outbound-only switch: PENDING alerts are stored and written to history
        // either way, so "off" does not mean nothing is happening.
        { label: "forward PENDING", on: on(config.forward_pending_to_whatsapp) },
        // The project-local Pending/open count that
        // POST /ailytics-safety/status-summary sends to whatsapp_group_ids.
        // Defaults to false and differs per project, which is what earns it a
        // pill: 2 of the 4 projects have it on.
        { label: "daily summary", on: on(config.status_summary_enabled) },
      ];
  }
}

/** Links derivable from the row itself. */
/**
 * Everything the search box should match a card on.
 *
 * Project code and company are the obvious ones. The interesting addition is the
 * card's own pills: typing "water parade" should surface the projects that
 * actually have it, which is the question someone is really asking when they
 * reach for the filter.
 *
 * **Only pills that are ON contribute.** A struck-through pill means the
 * capability is absent, so matching it would return exactly the projects the
 * searcher does not want. That is the whole distinction, and it is why this uses
 * `pillsFor` rather than a static list of known labels.
 *
 * Labels keep their emoji here and are lowercased; a substring match still works
 * because "water parade" is inside "💧 water parade".
 */
export function searchTokens(service: ServiceKey, config: ProjectConfigRow): string[] {
  return [
    String(config.project_code ?? ""),
    String(config.company ?? ""),
    ...pillsFor(service, config)
      .filter((pill) => pill.on)
      .map((pill) => pill.label),
  ]
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * How one severity cadence's send window reads on a card.
 *
 * Postgres hands a `time` column back as `HH:MM:SS`; the seconds are noise on a
 * card. Unset means round the clock — see `isInSendWindow` in the chaser's
 * lib/cadence.js, which returns true when no window is configured. A half-set
 * window is refused by a CHECK, but the service also treats it as never-due, so
 * it is worth saying rather than rendering as a blank.
 */
function severityWindow(config: ProjectConfigRow, startColumn: string, endColumn: string): string {
  const clip = (value: unknown) => String(value ?? "").trim().slice(0, 5);
  const start = clip((config as Record<string, unknown>)[startColumn]);
  const end = clip((config as Record<string, unknown>)[endColumn]);
  if (!start && !end) return "round the clock";
  if (!start || !end) return "on a half-set window — nothing is due until both ends are set";
  return `within ${start}–${end}`;
}

/** Whether a card matches a free-text query. An empty query matches everything. */
export function matchesQuery(service: ServiceKey, config: ProjectConfigRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return searchTokens(service, config).some((token) => token.includes(needle));
}

/**
 * A card's outbound links.
 *
 * `internal` marks the one link that is not a URL: a lightning project's map
 * opens the in-app evidence view rather than Google Maps, because a pin on
 * Google Maps says where the site is and nothing about whether a strike
 * qualified. Every other service keeps Google Maps — there is nothing in-app to
 * send them to.
 */
export type CardLink = { label: string; href: string; internal?: "lightning-map" };

export function autoLinks(service: ServiceKey, config: ProjectConfigRow): CardLink[] {
  const sheet = (id: unknown) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(String(id))}/edit`;
  const links: CardLink[] = [];
  if (config.monthly_sheet_id) links.push({ label: "📗 Monthly sheet", href: sheet(config.monthly_sheet_id) });
  if (config.google_sheet_id) links.push({ label: "📗 Analysis sheet", href: sheet(config.google_sheet_id) });
  if (config.spreadsheet_id) {
    // Same column, different documents: ailytics keeps its safety log there,
    // subcon its manpower workbook. Named for the document, not for a tab —
    // subcon reads `Manpower` and no longer writes `Daily Activity` at all.
    links.push({
      label: service === "subcon" ? "📗 Manpower workbook" : "📗 Safety sheet",
      href: sheet(config.spreadsheet_id),
    });
  }
  if (config.manpower_spreadsheet_id) {
    links.push({ label: "📗 Manpower sheet", href: sheet(config.manpower_spreadsheet_id) });
  }
  if (config.safety_sheet_id) {
    links.push({ label: "📗 Safety workbook", href: sheet(config.safety_sheet_id) });
  }
  if (config.latitude && config.longitude) {
    const external = `https://www.google.com/maps?q=${encodeURIComponent(`${config.latitude},${config.longitude}`)}`;
    links.push(
      service === "lightning"
        ? // `href` is kept as the Google Maps URL so a middle-click or a
          // right-click "open in new tab" still lands somewhere sensible; the
          // click handler takes precedence and opens the evidence map.
          { label: "⚡ Lightning map", href: external, internal: "lightning-map" }
        : { label: "📍 Map", href: external },
    );
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

/**
 * Which of subcon's two morning reports a project actually receives.
 *
 * Two gates, in the service's own order. `isSummaryEnabled` in that repo is
 * `config?.[column] === true`, so a report is sent only when its switch is
 * explicitly on — the columns are an explicit opt-in, and the repo's migration
 * says so outright ("Existing rows receive false so adding this migration
 * cannot unexpectedly start new report sends"). `enabled` then gates outbound
 * delivery for whichever survived.
 *
 * Matched to `=== true` rather than `!== false` deliberately: the card has to
 * predict what the service will do, and the two differ for a null or missing
 * value. The columns are NOT NULL so real rows cannot hit that, but a card
 * built from a partial row should under-claim rather than promise a send.
 */
export function subconReports(config: ProjectConfigRow): string[] {
  if (config.enabled === false) return [];
  const reports: string[] = [];
  if (config.enable_activity_summary === true) reports.push("activity + manpower");
  if (config.enable_manpower_summary === true) reports.push("manpower + machines");
  return reports;
}

/**
 * Which 5-minute crossings actually send, given the configured minimum.
 *
 * A blank column is not "unset" — it is the orange-only behaviour every project
 * had before `five_min_alert_threshold` existed, so it reads the same as an
 * explicit orange rather than as a gap.
 */
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

/** Cards with nothing scheduled sink to the bottom of the grid. */
export function hasCadence(service: ServiceKey, config: ProjectConfigRow): boolean {
  if (service === "wbgt") {
    return Boolean(
      config.enable_hourly ||
        config.enable_intermittent_reports ||
        config.enable_5min_alerts ||
        // Water Parade sends its own reminders, so the project is not idle.
        config.water_parade_enabled,
    );
  }
  if (service === "noise") {
    return Boolean(
      config.enable_5min ||
        config.enable_half_hourly ||
        config.enable_hourly ||
        config.enable_three_hour_summary ||
        config.enable_morning_summary ||
        config.enable_evening_summary ||
        config.enable_sunday_leq12h_hourly ||
        config.enable_7am_7pm_leq12hr_table,
    );
  }
  if (service === "subcon") {
    // Either route is work — a project with intake on is not idle. Reports are
    // counted through `subconReports`, not `enabled`, so a project left enabled
    // with both reports switched off reads as idle rather than as scheduled.
    return config.enable_housekeeping !== false || subconReports(config).length > 0;
  }
  if (service === "issueChaser") {
    // `enabled` alone sends nothing — a chaser style has to be on too, and a
    // CHECK means a style cannot be on unless `enabled` already is.
    return Boolean(
      config.severity_cadence_chaser_enabled ||
        config.same_day_open_snapshot_enabled ||
        // A summary is scheduled work too. Without these, a project running
        // only the 08:00 report would sink to the bottom as "nothing
        // scheduled" while it is messaging a site every morning.
        config.daily_safety_summary_enabled ||
        config.daily_safety_company_summary_enabled,
    );
  }
  return config.enabled !== false;
}

/** One chat id in a group-list change, and what happened to it. */
export type GroupDelta = { chatId: string; name: string; state: "added" | "removed" | "kept" };

/**
 * A change to a group-id column, as names rather than numbers.
 *
 * The confirmation panel used to print these columns the way it prints every
 * other value: the raw stored string, so approving a delivery change meant
 * reading `120363410971872748@g.us` and deciding from that whether it was the
 * right chat. Nobody can. The names are already loaded for the group picker on
 * the same screen, so the panel had them all along.
 *
 * It returns a per-id delta rather than two lists of names because names are
 * far longer than ids: rendering before-and-after as prose would have made a
 * one-group change harder to read, not easier. Removed first, then added, then
 * the untouched ones as context — the order someone checks a change in.
 *
 * An id with no known name keeps the id, which is honest: an alias that has not
 * been fetched must not look like a group that does not exist.
 */
export function groupDelta(
  from: unknown,
  to: unknown,
  names: Record<string, string> = {},
): GroupDelta[] {
  const before = splitList(from);
  const after = splitList(to);
  const label = (chatId: string) => ({ chatId, name: names[chatId] ?? chatId });
  return [
    ...before.filter((id) => !after.includes(id)).map((id) => ({ ...label(id), state: "removed" as const })),
    ...after.filter((id) => !before.includes(id)).map((id) => ({ ...label(id), state: "added" as const })),
    ...after.filter((id) => before.includes(id)).map((id) => ({ ...label(id), state: "kept" as const })),
  ];
}
