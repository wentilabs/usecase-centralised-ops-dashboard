import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";

/** Service-owned onboarding contract. Generic code validates and executes it. */
export const issueChaserOnboarding: OnboardDefinition = {
    service: "issueChaser",
    codePattern: /^[A-Z0-9][A-Z0-9-]{0,47}$/,
    codeHelp: "Uppercase letters, digits and hyphens only — the column CHECK rejects lowercase and underscores.",
    label: "＋ Add project",
    title: "Add a new Issue Chaser project",
    description:
      "Creates one disabled row in issue_chaser.project_configs. Enable it first, then switch on a chaser style — a CHECK enforces that order.",
    outsideHalo: [
      "Share the Safety workbook with the service account. The service reads the `Safety` tab and any `Safety-MMM YYYY` archives by header name, and never writes to it.",
      "The sheet needs `Status`, a date column and an issue identifier at minimum. `Message Id Serialized` is what lets a reminder land back in the group the issue came from.",
    ],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Uppercase only — anything else is refused.",
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
        column: "safety_sheet_id",
        label: "Safety workbook",
        kind: "sheet",
        required: true,
        notNull: true,
        help: "Source of all issue state. Required before the project can be enabled.",
      },
      {
        column: "whatsapp_group_ids",
        label: "WhatsApp group IDs",
        kind: "groups",
        required: false,
        notNull: false,
        help: "Fallback destinations. Not needed while Reply in the originating group is on, which is the default.",
      },
      // Not offered at creation and not written either: the column defaults to
      // false in Postgres, which is the right starting point for a route that
      // WRITES to the customer's workbook. Switching it on is a decision to make
      // against a project that already exists, in the editor, where the help
      // text explaining what it writes is in front of you.
      //
      //   novade_name_sync_enabled
      //   novade_name_list_check_enabled  (column not created yet)
      //   exclude_whatsapp_group_ids      (empty excludes nothing)
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
        help: "Outbound only — the workbook is still read, issues are still selected and a dry run still previews. It silences reminders and both daily summaries. Turn it off in the editor for a site that works Sundays.",
      },
      {
        column: "remove_ph_notifications",
        label: "Mute public holidays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Same, for the Singapore public holiday list built into the service, which currently runs to 25 Dec 2027. A later date counts as an ordinary working day.",
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
