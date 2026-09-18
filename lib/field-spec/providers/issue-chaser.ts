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
      help: "Labelling only — nothing reads it. Blank means it could not be worked out when the project was set up.",
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
      help: "Nothing runs while this is off. It cannot be switched on until the Safety workbook, an https send URL, instance and client are all set — and every chaser style below needs this on first.",
    },
    safety_sheet_id: {
      label: "Safety workbook",
      widget: "sheet",
      help: "Where every issue is read from: the `Safety` tab plus any `Safety-MMM YYYY` archives, matched by column header. The only thing ever written back is blank `Novade Name` cells, and only while Write back Novade names is on.",
    },
    // Each style says it needs `enabled` first, on the style itself. Saying it
    // only on `enabled` was not enough: the operator toggling a style is looking
    // at the style, and the database refuses the save
    // (issue_chaser_feature_requires_enabled_check) with a constraint name, not
    // a sentence. This is the inverse of every sibling service, where you
    // configure first and switch on last.
    severity_cadence_chaser_enabled: {
      label: "Severity cadence chaser",
      help: "Chases open issues until they are closed: P1 every 3 hours, P2 daily, P3 weekly. Round the clock unless you set a send window below, in which case anything due outside it waits for the next hour inside it.",
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
      help: "Only used for a manual one-off run — scheduled runs take their lookback from Snapshot schedule above. 0 is today only. Negative is refused.",
      showIf: { field: "same_day_open_snapshot_enabled", equals: true },
    },
    severity_p1_window_start: {
      label: "P1 window start",
      row: "p1_window",
      help: "Limits the P1 cadence to these hours, SGT. Enter four digits — 0700, 1900 — and it reads back as 07:00:00. The start hour counts and the end hour does not, so 0700–1900 stops at 18:59; overnight pairs like 2200–0600 work. Set both ends or neither, and they must differ.",
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
      help: "The same gate, shared by P2 and P3. Four digits, start hour counts and end hour does not, overnight allowed; set both ends or neither and they must differ.",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    severity_p2_p3_window_end: {
      label: "P2/P3 window end",
      row: "p2p3_window",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
      help: "Leave both ends empty for 24-hour eligibility.",
    },
    // f8b1848 with migrate_severity_reminder_age_limit.sql. Placed last in the
    // severity block, mirroring the snapshot above it: the switch, then when it
    // runs, then how far back it reaches.
    severity_only_last_x_days: {
      label: "Severity lookback (days)",
      help: "Limits the severity chaser to issues raised recently. Blank chases every open issue however old, which is what every project does today. 0 is today only; 6 is today plus the six days before it. A manual severity preview ignores this and can still reach anything open.",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    // Summaries are informational reports, not chasers: they read the workbook,
    // never touch delivery_events, and never chase anyone. Two CHECKs bite on
    // save — issue_chaser_feature_requires_enabled_check (needs `enabled`) and
    // issue_chaser_summary_destination_check (needs a group), and the second is
    // the surprising one, because it holds even when the project otherwise
    // replies in each issue's originating group.
    daily_safety_summary_enabled: {
      label: "Past-days safety summary",
      help: "A daily 08:00 SGT report: totals, open and closed, and P1/P2/P3 counts for each of the last few days. It never chases anyone. Goes to Plain summary destination; blank falls back to the shared destination, then to WhatsApp group IDs.",
    },
    daily_safety_company_summary_enabled: {
      label: "Past-days summary by company",
      help: "The same 08:00 report with an Open issues by company section under each date. Runs instead of, or alongside, the plain summary. An issue naming several companies counts once for each, so company totals can exceed the project total; blank cells show as Unknown company.",
    },
    summary_days: {
      label: "Summary window (days)",
      help: "Only used for a manual one-off run — scheduled runs take their window from their own schedule entry. Counts the end date itself, so 5 is today plus the four before it. Shared by all three summaries, and must be at least 1.",
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
      help: "Groups the same-day snapshot skips. Nothing else changes: severity reminders still reply where each issue came from, and the summaries still go to their own destination. Matching ignores case and spacing, and an empty list excludes nothing.",
    },
    // Not a report: it sends no WhatsApp message and needs no destination, which
    // is why it sits apart from the summaries and their group requirement.
    safety_summary_whatsapp_group_ids: {
      label: "Shared summary destination",
      widget: "groups",
      // Added by 807adfc so a daily report can go somewhere other than the
      // group the chasers use. Blank is not "nowhere": it falls back, which is
      // what kept every project working when the column was introduced.
      // Shown whether or not the summaries are on. A destination is something
      // you decide before you switch a report on, not after — and gating it on
      // the flag meant the only way to set it was to turn the report on first,
      // which sends it to the fallback in the meantime.
      help: "Where a summary goes when it has no destination of its own — the middle of three levels, below each summary's own field and above WhatsApp group IDs. Blank falls back to WhatsApp group IDs. Kept separate because a management summary and an issue reminder rarely belong in the same chat.",
    },
    // Text, not `csv`: the separator is `;` and `coerceValue` would rewrite a
    // comma list into its own shape and destroy the value.
    same_day_open_snapshot_schedule: {
      label: "Snapshot schedule",
      help: "When the snapshot runs, in SGT. `HH00,lookback`, semicolon-separated: `0900,0;2100,0` is 9am and 9pm each covering today only; `0800,4` is 8am covering today plus the 4 days before. Whole hours only — an entry that cannot be read stops the run, so nothing is sent.",
    },
    daily_safety_summary_whatsapp_group_ids: {
      label: "Plain summary destination",
      widget: "groups",
      help: "Where the plain past-days summary goes. Blank falls back to the shared Summary destination, and then to WhatsApp group IDs — three levels, most specific first.",
    },
    daily_safety_summary_schedule: {
      label: "Summary schedule",
      help: "When the plain summary runs, in SGT. `HH00,lookback`, semicolon-separated: `0800,4` is 8am covering today plus the 4 days before; `0900,0;2100,0` is 9am and 9pm each covering today only. Whole hours only — an entry that cannot be read stops the run, so nothing is sent.",
    },
    daily_safety_chatgroup_summary_enabled: {
      label: "Past-days summary by chat group",
      help: "The same report with an Open issues by ChatGroup section under each date. A third report with its own switch, independent of the other two — any combination can run. A row with a blank ChatGroup, or a workbook with no ChatGroup column, is counted under `Invalid chatgroup` rather than dropped, so the totals still add up.",
    },
    daily_safety_chatgroup_summary_whatsapp_group_ids: {
      label: "Chat group summary destination",
      widget: "groups",
      help: "Where the by-chat-group summary goes. Blank falls back to the shared Summary destination, and then to WhatsApp group IDs — three levels, most specific first.",
    },
    daily_safety_chatgroup_summary_schedule: {
      label: "Chat group summary schedule",
      help: "When the by-chat-group summary runs, in SGT. Its own schedule, so the three summaries can differ. `HH00,lookback`, semicolon-separated: `0800,4` is 8am covering today plus the 4 days before; `0900,0;2100,0` is 9am and 9pm each covering today only. Whole hours only — an entry that cannot be read stops the run, so nothing is sent.",
    },
    daily_safety_company_summary_whatsapp_group_ids: {
      label: "Company summary destination",
      widget: "groups",
      help: "Where the by-company summary goes. Blank falls back to the shared Summary destination, and then to WhatsApp group IDs — three levels, most specific first.",
    },
    daily_safety_company_summary_schedule: {
      label: "Company summary schedule",
      help: "When the by-company summary runs, in SGT. Its own schedule, so it can differ from the plain summary. `HH00,lookback`, semicolon-separated: `0800,4` is 8am covering today plus the 4 days before; `0900,0;2100,0` is 9am and 9pm each covering today only. Whole hours only — an entry that cannot be read stops the run, so nothing is sent.",
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
      help: "Fills blank `Novade Name` cells in the workbook from `Whatsapp Name` — the only thing here that writes to the sheet. Off, nothing is written. On, it still only previews unless the run explicitly asks to write, and it skips any name that is ambiguous.",
    },
    // The column does not exist in Supabase yet — supabase/migrate_novade_name_list_check.sql
    // in the issue-chaser repo is unrun, so `row.novade_name_list_check_enabled`
    // reads undefined and the weekly reminder can never fire. Named here anyway:
    // the editor renders from live introspection, so this shows nothing until
    // the migration lands and then appears already labelled.
    novade_name_list_check_enabled: {
      label: "Weekly Novade name reminder",
      help: "One weekly message counting people on the Novade Name List who have a phone and a WhatsApp name but no Novade name. Read-only, and silent when there are none. Goes to Reminder destination; blank falls back to WhatsApp group IDs — one of the two is needed.",
    },
    send_to_originating_groups: {
      label: "Reply in the originating group",
      help: "On, each reminder goes back to the group the issue came from. When that cannot be worked out it falls back to the group list below, but only if exactly one group is set — with several it is reported as ambiguous and skipped rather than guessed at. Off, everything goes to the group list. The summaries ignore this.",
    },
    whatsapp_group_ids: {
      label: "WhatsApp group IDs",
      widget: "groups",
      // No longer "the only destination for the daily summaries" — 807adfc gave
      // the summaries and the weekly Novade reminder their own, and this became
      // the fallback for both. The old wording sent an operator here to fix a
      // routing problem the two fields below now solve.
      help: "The default destination: used for reminders, and for any report whose own destination is blank. Required before the project can be enabled, unless Reply in the originating group is on.",
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
      help: "Must be https and end in /send-message. A trailing slash or an http URL blocks the project from being enabled.",
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
      help: "Nothing is sent on Sundays, SGT — reminders and both summaries. Only delivery stops: issues are still read, and the run still reports what it would have sent.",
    },
    remove_ph_notifications: {
      label: "Mute public holidays",
      row: "mutes",
      help: "The same, for the Singapore holiday list kept in the service's `lib/time.js`, which currently ends on 2027-12-25. A date past the end of that list is treated as an ordinary working day, so the list has to be extended before it can be relied on for a later year.",
    },
    timezone: {
      label: "Timezone",
      help: "Fixed to Asia/Singapore — every project runs on SGT, and nothing else will save.",
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
        "severity_only_last_x_days",
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
        "daily_safety_summary_whatsapp_group_ids",
        "daily_safety_company_summary_enabled",
        "daily_safety_company_summary_schedule",
        "daily_safety_company_summary_whatsapp_group_ids",
        "daily_safety_chatgroup_summary_enabled",
        "daily_safety_chatgroup_summary_schedule",
        "daily_safety_chatgroup_summary_whatsapp_group_ids",
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
