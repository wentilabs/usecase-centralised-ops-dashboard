import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const issueChaserFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "created_at", "updated_at"],
  checkEnums: {
    company: [...COMPANIES],
    timezone: ["Asia/Singapore"],
  },
  fields: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    // Two CHECK constraints shape everything here, and both bite on save rather
    // than at run time:
    //   issue_chaser_enabled_delivery_check — `enabled` is refused unless the
    //     sheet id and the full delivery set are present.
    //   issue_chaser_feature_requires_enabled_check — a style toggle is refused
    //     unless `enabled` is already true. That is the inverse of every sibling
    //     service, where you configure first and switch on last.
    enabled: {
      label: "Project enabled",
      help: "Refused unless the Safety sheet ID, an https send URL, instance and client are all set. Must be on before any chaser style can be turned on.",
    },
    safety_sheet_id: {
      label: "Safety workbook",
      widget: "sheet",
      help: "Source of all issue state. The service finds the `Safety` tab and any `Safety-MMM YYYY` archives and reads rows by header name. It also WRITES to one column of it now — `POST /api/sync-novade-names` fills blank `Novade Name` cells from `Whatsapp Name`, and only when the sync below is switched on. Nothing else in the service writes here.",
    },
    // Each style says it needs `enabled` first, on the style itself. Saying it
    // only on `enabled` was not enough: the operator toggling a style is looking
    // at the style, and the database refuses the save
    // (issue_chaser_feature_requires_enabled_check) with a constraint name, not
    // a sentence. This is the inverse of every sibling service, where you
    // configure first and switch on last.
    severity_cadence_chaser_enabled: {
      label: "Severity cadence chaser",
      help: "P1 every 3 hours, P2 daily, P3 weekly — all round the clock by default. The old fixed 07:00–19:00 hours were retired when per-priority send windows became configurable; where those columns exist they appear here, and a due time outside a set window waits for the next in-window tick.",
    },
    same_day_open_snapshot_enabled: {
      label: "Same-day open snapshot",
      help: "Issues opened today and still open — deliberately does not chase older ones. When it runs is set by Snapshot schedule below, which every project was migrated to with its old 09:00 and 21:00 times.",
    },
    // Each style's own settings sit directly under it and are hidden until the
    // style is on, so the group reads as three cadences rather than eleven
    // switches. `time` columns get the default text widget deliberately: the
    // `hhmm` widget caps input at four characters, and while four digits are now
    // the documented way to WRITE these, Postgres hands back `07:00:00` — so a
    // four-character cap would silently truncate the value already stored.
    include_days_before_snapshot: {
      label: "Snapshot lookback (days)",
      help: "The lookback for an explicit one-off call only — `scheduled: false`, or `include_days_before` overriding it. 0 is today only. Every scheduled run, which is now the default, takes its lookback from the matching Snapshot schedule entry instead and ignores this. Negative is refused by the database (issue_chaser_snapshot_lookback_check).",
      showIf: { field: "same_day_open_snapshot_enabled", equals: true },
    },
    severity_p1_window_start: {
      label: "P1 window start",
      row: "p1_window",
      help: "Optional SGT gate for the P1 cadence, which otherwise runs round the clock. Enter it as four digits — 0700, 1900 — though Supabase shows the stored value back as 07:00:00 and the service reads either. The window is half-open [start, end), so 0700 is eligible and 1900 is not, and an overnight pair like 2200–0600 is supported. Set BOTH ends or neither, and they must differ: the database refuses one alone or two the same (issue_chaser_p1_window_check).",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    severity_p1_window_end: {
      label: "P1 window end",
      row: "p1_window",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
      help: "Leave both ends empty for 24-hour eligibility.",
    },
    severity_p2_p3_window_start: {
      label: "P2/P3 window start",
      row: "p2p3_window",
      help: "Optional SGT gate shared by the P2 and P3 cadences. Same rules as P1 — four digits, half-open, overnight allowed, both ends or neither and they must differ (issue_chaser_p2_p3_window_check).",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    severity_p2_p3_window_end: {
      label: "P2/P3 window end",
      row: "p2p3_window",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
      help: "Leave both ends empty for 24-hour eligibility.",
    },
    // Summaries are informational reports, not chasers: they read the workbook,
    // never touch delivery_events, and never chase anyone. Two CHECKs bite on
    // save — issue_chaser_feature_requires_enabled_check (needs `enabled`) and
    // issue_chaser_summary_destination_check (needs a group), and the second is
    // the surprising one, because it holds even when the project otherwise
    // replies in each issue's originating group.
    daily_safety_summary_enabled: {
      label: "Past-days safety summary",
      help: "08:00 SGT daily. Read-only report: total, open and closed plus P1/P2/P3 counts across the last few SGT dates, and each date's open count. Goes to Summary destination, and falls back to WhatsApp group IDs when that is blank — one of the two has to be set, and a summary is a project-level report, so it never replies in an issue's originating group.",
    },
    daily_safety_company_summary_enabled: {
      label: "Past-days summary by company",
      help: "The same 08:00 SGT report with an Open issues by company section under each date. A separate route and flag, so it can run instead of, or alongside, the plain summary. A row naming several companies counts once for each, so company totals can exceed the project total; blank cells show as Unknown company, and a workbook with no Company column produces the plain report.",
    },
    summary_days: {
      label: "Summary window (days)",
      help: "The window for an explicit one-off call only — `scheduled: false` — counting the end date itself, so 5 is today plus the four before it. Shared by all three summaries. Every scheduled run, which is now the default, uses the lookback on its own schedule entry plus the current date. Must be at least 1; the database refuses 0 (issue_chaser_summary_days_check).",
      showIf: {
        anyOf: [
          { field: "daily_safety_summary_enabled", equals: true },
          { field: "daily_safety_company_summary_enabled", equals: true },
        ],
      },
    },
    // priority_one_escalation_enabled is retired too, and was the last one
    // still described here. `migrate_issue_chaser_latest.sql` drops it in the
    // same statement as the four below, `setup.sql` never creates it, and no
    // code in that repo reads it — so the P1 escalation digest is gone, not
    // merely off. It rendered as a permanently-unlit pill on every card, which
    // is the exact trap the note below is about.
    //
    // include_issue_images, mention_sender_fallback, pic_mentions_enabled and
    // require_origin_chat_identity were REMOVED from issue_chaser.project_configs
    // by 412256d ("harden reminder routing and mentions"): PIC resolution and
    // image delivery are built in now, reporter mentions are the final PIC
    // fallback rather than a setting, and the single configured-group origin
    // fallback is unconditional. `deliveryConfig` in that repo's config/index.js
    // explicitly deletes all four, so they are behaviour, not configuration.
    // Snapshot-only, which is the whole point of it: the severity chaser still
    // replies wherever an issue came from, and the summaries still go to the
    // full group list. Naming it "exclude groups" without saying from WHAT would
    // read as a project-wide mute.
    exclude_whatsapp_group_ids: {
      label: "Excluded from the snapshot",
      widget: "groups",
      help: "Groups the 09:00/21:00 same-day snapshot skips. Nothing else: severity reminders still reply in each issue's originating group, and both daily summaries still go to their own destination. Matching is trimmed and case-insensitive, and an empty list excludes nothing.",
    },
    // Not a report: it sends no WhatsApp message and needs no destination, which
    // is why it sits apart from the summaries and their group requirement.
    safety_summary_whatsapp_group_ids: {
      label: "Summary destination",
      widget: "groups",
      // Added by 807adfc so a daily report can go somewhere other than the
      // group the chasers use. Blank is not "nowhere": it falls back, which is
      // what kept every project working when the column was introduced.
      // Shown whether or not the summaries are on. A destination is something
      // you decide before you switch a report on, not after — and gating it on
      // the flag meant the only way to set it was to turn the report on first,
      // which sends it to the fallback in the meantime.
      help: "Where the past-days summaries go when they are on — all three of them. Blank falls back to WhatsApp group IDs, which is what every project did before this field existed. Separate from the chaser groups on purpose: a management summary and an issue reminder rarely belong in the same chat.",
    },
    // Text, not `csv`: the separator is `;` and `coerceValue` would rewrite a
    // comma list into its own shape and destroy the value.
    same_day_open_snapshot_schedule: {
      label: "Snapshot schedule",
      help: "When the same-day snapshot runs, and how far back each run looks. Semicolon-separated `HH00,lookback` entries — `0900,0;2100,0` is two runs a day covering today only, `0800,4` is one run covering today plus the four dates before it. The lookback counts PRECEDING dates; the current date is always included, so the number is one less than the number of days reported. Minutes are always `00`: the cron may fire at any minute in the hour and only the hour is matched, in SGT. This is the normal path: an invocation that says nothing is a live scheduled run (833ab88 made `scheduled` default to true), so the cron fires hourly and this decides which hours do anything. Only an explicit `scheduled: false` bypasses it for a one-off. An entry the service cannot parse fails the whole run with `invalid_project_schedule`, so nothing is sent.",
    },
    daily_safety_summary_schedule: {
      label: "Summary schedule",
      help: "When the plain past-days summary runs, and how many dates each run covers. Semicolon-separated `HH00,lookback` entries — `0900,0;2100,0` is two runs a day covering today only, `0800,4` is one run covering today plus the four dates before it. The lookback counts PRECEDING dates; the current date is always included, so the number is one less than the number of days reported. Minutes are always `00`: the cron may fire at any minute in the hour and only the hour is matched, in SGT. This is the normal path: an invocation that says nothing is a live scheduled run (833ab88 made `scheduled` default to true), so the cron fires hourly and this decides which hours do anything. Only an explicit `scheduled: false` bypasses it for a one-off. An entry the service cannot parse fails the whole run with `invalid_project_schedule`, so nothing is sent.",
    },
    daily_safety_chatgroup_summary_enabled: {
      label: "Past-days summary by chat group",
      help: "The same report with an Open issues by ChatGroup section under each date. A third route and flag, independent of the other two — any combination can run. A row whose ChatGroup cell is blank, or a workbook with no ChatGroup column at all, is counted under `Invalid chatgroup` rather than dropped, so the totals still add up.",
    },
    daily_safety_chatgroup_summary_schedule: {
      label: "Chat group summary schedule",
      help: "When the by-chat-group summary runs, and how many dates each run covers. Its own schedule, so all three summaries can run at different hours. Semicolon-separated `HH00,lookback` entries — `0900,0;2100,0` is two runs a day covering today only, `0800,4` is one run covering today plus the four dates before it. The lookback counts PRECEDING dates; the current date is always included, so the number is one less than the number of days reported. Minutes are always `00`: the cron may fire at any minute in the hour and only the hour is matched, in SGT. This is the normal path: an invocation that says nothing is a live scheduled run (833ab88 made `scheduled` default to true), so the cron fires hourly and this decides which hours do anything. Only an explicit `scheduled: false` bypasses it for a one-off. An entry the service cannot parse fails the whole run with `invalid_project_schedule`, so nothing is sent.",
    },
    daily_safety_company_summary_schedule: {
      label: "Company summary schedule",
      help: "When the by-company summary runs, and how many dates each run covers. Separate from the plain summary's schedule, so the two can run at different hours. Semicolon-separated `HH00,lookback` entries — `0900,0;2100,0` is two runs a day covering today only, `0800,4` is one run covering today plus the four dates before it. The lookback counts PRECEDING dates; the current date is always included, so the number is one less than the number of days reported. Minutes are always `00`: the cron may fire at any minute in the hour and only the hour is matched, in SGT. This is the normal path: an invocation that says nothing is a live scheduled run (833ab88 made `scheduled` default to true), so the cron fires hourly and this decides which hours do anything. Only an explicit `scheduled: false` bypasses it for a one-off. An entry the service cannot parse fails the whole run with `invalid_project_schedule`, so nothing is sent.",
    },
    novade_name_list_check_whatsapp_group_ids: {
      label: "Reminder destination",
      widget: "groups",
      // Same, and more so: no project has the weekly reminder on, so gating
      // this on the flag hid it on every row in the estate.
      help: "Where the weekly Novade name reminder goes when it is on. Blank falls back to WhatsApp group IDs.",
    },
    novade_name_sync_enabled: {
      label: "Write back Novade names",
      help: "Lets `POST /api/sync-novade-names` fill blank `Novade Name` cells in the workbook from `Whatsapp Name`. The only thing in this service that writes to the sheet. Off, the route refuses; on, it is still dry-run unless the request sets `dryRun: false`, and it skips any WhatsApp name that normalises ambiguously. Sends no message, so it needs no group.",
    },
    // The column does not exist in Supabase yet — supabase/migrate_novade_name_list_check.sql
    // in the issue-chaser repo is unrun, so `row.novade_name_list_check_enabled`
    // reads undefined and the weekly reminder can never fire. Named here anyway:
    // the editor renders from live introspection, so this shows nothing until
    // the migration lands and then appears already labelled.
    novade_name_list_check_enabled: {
      label: "Weekly Novade name reminder",
      help: "`POST /api/remind-write-novade-names` — one weekly message counting `Novade Name List` rows that have a phone and a WhatsApp name but no Novade name. Read-only, and silent when the count is zero. Goes to Reminder destination, and falls back to WhatsApp group IDs when that is blank — one of the two has to be set, because it is a project-level report rather than a reply to an issue.",
    },
    send_to_originating_groups: {
      label: "Reply in the originating group",
      help: "On, each reminder goes to the group recovered from the sheet's `Message Id Serialized`. When that cannot be recovered it falls back to the group list below ONLY if exactly one group is configured — with several it is reported as an ambiguous-routing error and skipped, rather than guessed at. Off, everything goes to the group list, which is then required. Applies to reminders only: the daily summaries ignore this and use Summary destination — or the group list when that is blank — so one project report is never copied into every issue's origin group.",
    },
    whatsapp_group_ids: {
      label: "WhatsApp group IDs",
      widget: "groups",
      // No longer "the only destination for the daily summaries" — 807adfc gave
      // the summaries and the weekly Novade reminder their own, and this became
      // the fallback for both. The old wording sent an operator here to fix a
      // routing problem the two fields below now solve.
      help: "The default destination: fallback for reminders, and for the two report destinations below when they are blank. Required to enable the project unless Reply in the originating group is on. A report with its own destination set does not need this one as well.",
    },
    // All three are part of issue_chaser_enabled_delivery_check, so a blank one
    // is not a missing nicety — it makes `enabled` unsavable. The URL's shape is
    // checked by the database too, which is worth saying before a save fails on
    // a trailing slash.
    instance_name: {
      label: "WhatsApp instance",
      row: "wa_identity",
      help: "Required before the project can be enabled.",
    },
    client_id: {
      label: "Client ID",
      row: "wa_identity",
      help: "Required before the project can be enabled.",
    },
    lambda_url: {
      label: "Send-message proxy URL",
      help: "Must be https and end in /send-message — the database checks the shape, so a trailing slash or an http URL makes Project enabled unsavable.",
    },
    // Delivery-only, and unlike the chaser styles they are NOT gated by
    // `enabled` — the service evaluates them at send time in both runProject and
    // runSummaryProject, so they cover the reminders and both daily summaries.
    // Everything upstream of the send still runs: the workbook is read, issues
    // are selected, cadence is calculated, and a dryRun request returns its
    // normal preview. A muted real run is reported as suppressed rather than as
    // nothing due.
    remove_sunday_notifications: {
      label: "Mute Sundays",
      row: "mutes",
      help: "Suppresses every outbound message on SGT Sundays — reminders and both daily summaries. The sheet is still read and the run still reports what it would have sent, so a Sunday looks like a suppression in the logs, not like an empty day.",
    },
    remove_ph_notifications: {
      label: "Mute public holidays",
      row: "mutes",
      help: "The same, for the Singapore holiday list kept in the service's `lib/time.js`, which currently ends on 2027-12-25. A date past the end of that list is treated as an ordinary working day, so the list has to be extended before it can be relied on for a later year.",
    },
    timezone: {
      label: "Timezone",
      help: "Pinned to Asia/Singapore by a CHECK; the reference projects are all SGT and nothing else will save.",
    },

    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    { title: "Status", fields: ["enabled", "company", "timezone"] },
    { title: "Safety sheet", fields: ["safety_sheet_id"] },
    {
      title: "Chaser styles",
      fields: [
        "severity_cadence_chaser_enabled",
        "severity_p1_window_start",
        "severity_p1_window_end",
        "severity_p2_p3_window_start",
        "severity_p2_p3_window_end",
        "same_day_open_snapshot_enabled",
        "same_day_open_snapshot_schedule",
        "include_days_before_snapshot",
      ],
    },
    {
      title: "Daily summaries",
      fields: [
        "daily_safety_summary_enabled",
        "daily_safety_summary_schedule",
        "daily_safety_company_summary_enabled",
        "daily_safety_company_summary_schedule",
        "daily_safety_chatgroup_summary_enabled",
        "daily_safety_chatgroup_summary_schedule",
        "summary_days",
        "safety_summary_whatsapp_group_ids",
      ],
    },
    // Its own section: one reads the Name List and one writes to it, and neither
    // is a chaser or a summary.
    {
      title: "Novade names",
      fields: [
        "novade_name_list_check_enabled",
        "novade_name_list_check_whatsapp_group_ids",
        "novade_name_sync_enabled",
      ],
    },
    // Each report's destination sits directly under the switch that turns the
    // report on, rather than together down here: you are choosing where THIS
    // report goes, and reading the two side by side is what makes the fallback
    // legible. What matters is that none of them is hidden — they used to be
    // gated on their own flag, which put the Novade destination out of reach on
    // every project in the estate.
    {
      title: "Delivery",
      fields: [
        "send_to_originating_groups",
        "whatsapp_group_ids",
        "exclude_whatsapp_group_ids",
        "instance_name",
        "client_id",
        "lambda_url",
      ],
    },
    // Below Delivery, and covering everything above it: the chasers and both
    // summaries stop on a muted date, whichever destination they would use.
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
  ],
};
