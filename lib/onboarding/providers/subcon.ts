import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";

/** Service-owned onboarding contract. Generic code validates and executes it. */
export const subconOnboarding: OnboardDefinition = {
    service: "subcon",
    // The table has no CHECK on project_code and the code is not used to build an
    // identifier, so this is HALO's own conservative rule.
    codePattern: /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/,
    codeHelp: "Letters, digits, spaces, hyphen and underscore.",
    label: "＋ Add project",
    title: "Add a new Subcon Activities project",
    description:
      "Creates one row in manpower_activity.project_configs. Three routes: housekeeping intake, and two separate morning reports — activity + manpower, and manpower + machines.",
    outsideHalo: [
      "Share the manpower workbook with the service account — read access is enough. This service never creates or writes a tab: it reads `Manpower`, and `Machines` when present, both owned by the base template, and keeps its own record in Supabase.",
      "Fill in the source group IDs. They are the only thing that routes a message to this project. With no groups, intake is switched on and nothing arrives.",
      "Point the base template's forwarder at this service, and confirm the groups it forwards from are the ones listed here.",
      "Opt the project into whichever morning reports it should get. They are two different messages and independent of each other, so both on is normal — but each is an explicit opt-in the service checks for `true`, and a project with neither switched on sends nothing however else it is configured.",
      "Both reports need a destination group as well as the send URL. With the group blank they stay switched on and deliver nothing.",
    ],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "How a forwarded message is resolved to this row.",
      },
      {
        column: "company",
        label: "Company",
        kind: "select",
        required: false,
        notNull: false,
        // Identity only — nothing reads it — but it drives the card watermark and
        // the search box, so it is worth setting while someone knows the answer.
        // Blank stays legal: a new operating company arrives before this list does.
        options: ["", ...COMPANIES],
        help: "Identity only; no code reads it. Sets the card's background mark and makes the project findable by company.",
      },
      {
        column: "spreadsheet_id",
        label: "Manpower workbook",
        kind: "sheet",
        required: true,
        notNull: true,
        help: "Must already exist and be shared with the service account. Read access is enough — this service never writes to it.",
      },
      // The three switches that decide what a subcon project actually does,
      // offered at creation because each is an explicit opt-in the service
      // checks for `true` — a project onboarded without them runs intake and
      // sends nothing, which is a confusing state to hand someone.
      {
        column: "enable_housekeeping",
        label: "Housekeeping",
        kind: "toggle",
        required: false,
        notNull: true,
        // `false`, matching the live column default and the service, which
        // reads this as `=== true`. It was `true` here, from when the flag
        // gated the inbound route alone and leaving it on cost nothing.
        // 5df3928 widened it to the whole feature (INV-HK-01), so HALO was
        // creating projects with intake, the nightly report, sheet generation
        // and the photo refresh all live on day one.
        fallback: "false",
        help: "The whole housekeeping feature: forwarded messages, the nightly report, the HOUSEKEEPING sheet and the photo refresh. Off by default, like the service — turn it on once the housekeeping groups below are right, because it starts accepting and reporting immediately.",
      },
      {
        column: "enable_manpower_summary",
        label: "Manpower + machines report",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "The plain per-company headcount, which also reads the `Machines` tab. Its own opt-in: off means it is never sent.",
      },
      {
        column: "enable_activity_summary",
        label: "Activity + manpower report",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "The morning activity and manpower message. Independent of the report above; either can run without the other.",
      },
      {
        column: "safety_group_ids",
        label: "Housekeeping groups (in and out)",
        kind: "groups",
        // Not required, because the column is NOT NULL with a '' default and a
        // project is often drafted before its groups exist. The gap is called
        // out in `outsideHalo` instead, and the card's "message source" pill
        // shows it as unlit until it is filled.
        required: false,
        notNull: true,
        help: "The only thing that routes a message to this project. Without at least one group, intake is on and nothing arrives.",
      },
      {
        column: "manpower_activity_outbound_group_id",
        label: "Morning report group",
        kind: "groups",
        required: false,
        notNull: true,
        help: "Where the daily summary is sent.",
      },
      // Written rather than asked about, like every sibling service. The live
      // column defaults to true here, but the column was added with `false`
      // first and backfilled, so an omitted field would depend on which
      // migration a database happens to have run. HALO states the value.
      {
        column: "remove_sunday_notifications",
        label: "Mute Sundays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Outbound only — intake still runs and is still recorded on a muted date, and the roster is still captured. It silences the two morning reports and the nightly housekeeping report. Turn it off in the editor for a site that works Sundays.",
      },
      {
        column: "remove_ph_notifications",
        label: "Mute public holidays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Same, for the Singapore holiday list in the service's `utils/notification-calendar.js`, which currently ends on 2027-12-25.",
      },
      { column: "instance_name", label: "WhatsApp instance", kind: "text", required: false, notNull: false },
      { column: "client_id", label: "Client ID", kind: "text", required: false, notNull: false },
      {
        column: "lambda_url",
        label: "Send-message URL",
        kind: "text",
        required: false,
        notNull: false,
        envDefault: "DEFAULT_LAMBDA_URL_SEND",
      },
    ],
  };
