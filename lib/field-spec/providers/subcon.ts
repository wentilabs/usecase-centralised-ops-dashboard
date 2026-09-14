import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const subconFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["id", "project_code", "created_at", "updated_at"],
  checkEnums: { company: [...COMPANIES] },
  fields: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    // Two routes: POST /housekeeping-intake accepts forwarded messages, and
    // POST /daily-activity-manpower-summary sends the morning report. Water
    // Parade belongs to WBGT, and the base template still owns manpower
    // classification and the Manpower/Machines tabs.
    enable_housekeeping: {
      label: "Housekeeping",
      // Widened on 11 Sep 2026 (5df3928). It used to gate the intake route
      // alone, and this help said so — which is now the opposite of what the
      // service does. INV-HK-01 exists because the surface reading is still
      // the old one.
      help: "The whole housekeeping feature, not just intake (INV-HK-01): forwarded messages, the nightly report, HOUSEKEEPING sheet generation and the photo refresh all stop when this is off, and the routes answer `skipped` without reading or writing anything. Existing events and sheet rows are kept, so turning it back on resumes rather than rebuilds. Only an explicit yes counts. Separate from Scheduled reports, which gates outbound delivery and does not switch housekeeping off — and separate from the two summaries, which have their own flags.",
    },
    // `enabled` covers BOTH scheduled reports, which the old wording hid by
    // naming only one of them. The service runs two routes off one flag:
    // POST /daily-activity-summary and POST /daily-manpower-summary, each
    // gated by `project.enabled !== false` and each falling back to the same
    // outbound group.
    enabled: {
      label: "Project enabled",
      // It was labelled "Scheduled reports", inside a group of the same name,
      // which read as a switch about reports — and since 5df3928 it gates the
      // nightly housekeeping report too, so that reading cost more than it
      // used to. The old help also led with "this is not a master switch",
      // which is true of intake and false of everything that sends.
      help: "Nothing scheduled goes out while this is off — neither morning report, and not the nightly housekeeping report either. It does not SELECT the reports: each is its own opt-in below, so this being on with all of them off sends nothing. Housekeeping intake and state processing continue regardless, which is the one thing it does not govern (INV-HK-01).",
    },
    // Each report is an explicit opt-in: the service checks
    // `config[column] === true`, so off is the safe state and a project can be
    // enabled while sending nothing. Worth saying on the controls, because
    // "Scheduled reports is on" no longer implies a report goes out.
    enable_activity_summary: {
      label: "Activity + manpower report",
      help: "POST /daily-activity-summary — the morning activity/manpower message. Explicit opt-in: off means this report is not sent, whatever Scheduled reports says. With Scheduled reports off it still reads Sheets and writes its Supabase summary; only delivery is suppressed.",
      showIf: { field: "enabled", equals: true },
    },
    enable_manpower_summary: {
      label: "Manpower + machines report",
      help: "POST /daily-manpower-summary — the plain per-company headcount, which also reads the `Machines` tab when it exists. Explicit opt-in, independent of the report above: either can run without the other, and with both off the project sends no morning report at all. With Scheduled reports off it still reads the workbook and writes its summary state; only the message is withheld.",
      showIf: { field: "enabled", equals: true },
    },
    // Both directions since 140b1e9: `housekeepingOutboundIds` now returns
    // `safetyGroupIds`, so this one list routes forwarded messages IN and is
    // where the nightly housekeeping report goes OUT. It used to be inbound
    // only, and the old help said so in bold — worth being explicit that
    // editing it now moves a destination as well as a source.
    safety_group_ids: {
      label: "Housekeeping groups (in and out)",
      widget: "groups",
      help: "Both directions. Inbound: the only thing that routes a forwarded message to this project — no client-identifier fallback, and several project codes may share a listener client (INV-HK-10). Outbound: where the nightly housekeeping report is sent. Editing this list changes both at once. Comma-separated; empty means nothing arrives AND the housekeeping report has nowhere to go, which is the default on a fresh row.",
    },
    spreadsheet_id: {
      label: "Manpower workbook",
      widget: "sheet",
      help: "Required, and must be shared with the service account — read access is enough. It initialises the housekeeping roster once per project per SGT date and remains the morning report's input (INV-HK-05, INV-HK-12). Read-only since Supabase became canonical: the service no longer creates or writes any tab, including the `Daily Activity` projection it used to maintain. It reads `Manpower`, and `Machines` when present; both belong to the base template.",
    },
    manpower_activity_outbound_group_id: {
      label: "Morning report group",
      widget: "groups",
      help: "Where the two morning summaries are sent — and only those. The nightly housekeeping report stopped falling back to this column in 140b1e9 and now uses the housekeeping groups instead. Empty by default while Scheduled reports defaults on, so a fresh row is switched on with nowhere to send and nothing errors (INV-HK-09). A report request may override it with groupId/groupIds.",
    },
    // Same column name as WBGT's, and a DIFFERENT filter: this one governs the
    // housekeeping roster and the manpower summary, WBGT's governs the Water
    // Parade roster. Both default on, and both exist because Woh Hup is the main
    // contractor rather than a participant.
    exclude_wohhup_from_manpower: {
      label: "Exclude Woh Hup from the roster",
      help: "On by default, which is the historical behaviour: Woh Hup, Wohhup and WHPL rows are dropped when the central `Manpower` tab is read. Applies to the plain report, the activity + manpower summary, and the first housekeeping-roster capture of the day (INV-HK-12). Off only where those rows are genuine participants.",
    },

    // Delivery-only, and they cover all THREE outbound reports — the two
    // morning summaries and the nightly housekeeping report — because the
    // service evaluates them inside each send path. Intake is untouched: a
    // forwarded message on a Sunday is still accepted and still recorded in
    // Supabase, and the day's roster is still captured. The day is not skipped,
    // only unannounced.
    remove_sunday_notifications: {
      label: "Mute Sundays",
      row: "mutes",
      help: "Suppresses all three outbound reports on SGT Sundays. Intake, the Supabase record and the roster capture continue, and a dry run still returns its message. Only checked when Scheduled reports is on, so it changes nothing on a project that sends nothing.",
    },
    remove_ph_notifications: {
      label: "Mute public holidays",
      row: "mutes",
      help: "The same, for the Singapore holiday list kept in the service's `utils/notification-calendar.js`, which currently ends on 2027-12-25. A date past the end of that list is treated as an ordinary working day rather than guessed at, so the list has to be extended before it can be relied on for a later year.",
    },

    // The delivery trio, on every service. Named here because a blank one is
    // silent: the report is generated, the send fails, and the card looks fine.
    instance_name: {
      label: "WhatsApp instance",
      row: "wa_identity",
      help: "Listener instance behind the proxy. Blank means the morning report cannot be delivered.",
    },
    client_id: {
      label: "Client ID",
      row: "wa_identity",
      help: "Selects the sending account on that instance.",
    },
    lambda_url: {
      label: "Send-message proxy URL",
      help: "The project listener's /send-message endpoint. Blank means nothing is delivered, however the toggles read.",
    },

    // Editable here, unlike every sibling service, because `id` is the primary
    // key and HALO edits by it — so renaming the code does not orphan the row.
    // It is still how a forwarded message resolves to this project, so a rename
    // moves the routing with it.
    project_code: {
      label: "Project code",
      help: "How a forwarded message resolves to this project. Unique, and not the primary key here — HALO edits by `id`, so this can be corrected without recreating the row.",
    },
    id: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    // `enabled` leads, here and in every other service: it is the highest
    // level of control on the row, and reading it after the company — or, as
    // it was, four sections down inside "Scheduled reports" — invites the
    // reading that it governs only what surrounds it.
    { title: "Project", fields: ["enabled", "company", "project_code"] },
    // Renamed from "Intake": the group list in here is now a destination too,
    // so filing it under intake alone understated what editing it does.
    { title: "Housekeeping", fields: ["enable_housekeeping", "safety_group_ids"] },
    // The Woh Hup filter sits with the workbook it filters, not with the report,
    // because it also shapes the first roster capture of the day — which happens
    // whether or not the morning report is switched on.
    { title: "Google Sheets", fields: ["spreadsheet_id", "exclude_wohhup_from_manpower"] },
    {
      title: "Scheduled reports",
      fields: [
        "enable_activity_summary",
        "enable_manpower_summary",
        "manpower_activity_outbound_group_id",
        "instance_name",
        "client_id",
        "lambda_url",
      ],
    },
    // Their own section rather than a line inside "Scheduled reports": they
    // also silence the nightly housekeeping report, which is configured two
    // groups up, so filing them under either one would understate their reach.
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
  ],
};
