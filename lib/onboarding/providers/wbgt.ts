import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";
import { wbgtTableForProject } from "../naming";

/** Service-owned onboarding contract. Generic code validates and executes it. */
export const wbgtOnboarding: OnboardDefinition = {
    service: "wbgt",
    // No CHECK on the column, but normalizeProjectCode() rejects anything whose
    // normalised form does not start with a letter — "106" would throw.
    codePattern: /^[A-Za-z][A-Za-z0-9 _-]{0,47}$/,
    codeHelp: "Must start with a letter. Spaces and hyphens are fine — CR 106 becomes cr_106_wbgt_data_hourly.",
    label: "＋ Add project",
    title: "Add a new WBGT project",
    description:
      "Creates the project's readings table, one disabled config row, and a sensor row. Fill in the sensor label and delivery details, then enable it in the editor.",
    outsideHalo: [
      "Set the sensor label to match the CloudLynx AMR dropdown text character-exactly — whitespace, parentheses and the trailing (WC-NN) all matter. A mismatch is silent: the scrape reports missing_configured_sensors and collects nothing.",
      "For a source type other than default, the Lambda needs that profile's CloudLynx credentials and its own Browserbase context — the profiles must never share one.",
      "Share the monthly workbook with the service account as Editor, and give it a `Template Monitoring Record` tab. The job clones that tab into `<Mon>-<YYYY>` on the month's first reading.",
    ],
    rpc: {
      fn: "ensure_project_readings_table",
      args: (projectCode) => ({ p_project_code: projectCode }),
      describes: "the project's readings table",
      expects: wbgtTableForProject,
    },
    companion: {
      table: "wbgt_sensors",
      label: "sensor",
      onConflict: "project_code,sensor_label",
      build: (draft, projectCode) => [
        {
          project_code: projectCode,
          // Placeholder rather than a guess: only CloudLynx knows the real
          // label, and a plausible-looking wrong one would fail silently.
          sensor_label: String(draft.sensor_label ?? "").trim() || `${projectCode} — set the CloudLynx label`,
          site_name: String(draft.site_name ?? "").trim() || null,
          active: true,
        },
      ],
    },
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Also names the readings table — CR 106 becomes cr_106_wbgt_data_hourly. Must start with a letter.",
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
        column: "sensor_label",
        target: "companion",
        label: "Sensor label",
        kind: "text",
        required: false,
        notNull: false,
        help: "Must match the CloudLynx dropdown exactly. Left blank, a clearly-marked placeholder is written so the row exists and can be corrected.",
      },
      {
        column: "site_name",
        target: "companion",
        label: "Site name",
        kind: "text",
        required: false,
        notNull: false,
        help: "Optional. Shown before the timestamp in the message footer.",
      },
      {
        column: "source_type",
        label: "Login profile",
        kind: "text",
        required: false,
        notNull: true,
        fallback: "default",
        help: "default, whgd, svs or pentaocean. Each needs its own credentials and Browserbase context on the Lambda.",
      },
      // Hidden, and ON for a new project. Same rule as haze and lightning: a
      // site that works Sundays or holidays has them turned off in the editor,
      // which is the rarer case. Both columns default to false in Postgres, so
      // these have to be written rather than omitted.
      {
        column: "remove_sunday_notifications",
        label: "Mute Sundays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Outbound only — scraping, readings and the sheets continue. On by default for a new project.",
      },
      {
        column: "remove_ph_notifications",
        label: "Mute public holidays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Same, for the hard-coded Singapore holiday list.",
      },
      // The site day, written but not asked about — the same 08:00-19:00 as haze
      // and lightning. WBGT keeps it in two integer HOUR columns rather than an
      // HHMM pair, and `site_hours_end` is EXCLUSIVE: 19 means the 18:00 hour is
      // the last one that fires. The column default is 18, so this has to be
      // written rather than omitted.
      {
        column: "site_hours_start",
        label: "Site hours start",
        kind: "number",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "8",
        range: { min: 0, max: 23 },
        help: "Hour of day, SGT. 8 = messages from 08:00.",
      },
      {
        column: "site_hours_end",
        label: "Site hours end",
        kind: "number",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "19",
        range: { min: 1, max: 24 },
        help: "Exclusive: 19 means the 18:00 hour is the last one that fires.",
      },
      {
        column: "monthly_sheet_id",
        label: "Monthly sheet ID",
        kind: "sheet",
        // Nullable, so not required. ⟳ Sync sheets is gated on it, and the
        // Water Parade Log is written into this same workbook rather than the
        // manpower one — the mistake that made a rebuild report `completed`
        // while writing nothing.
        required: false,
        notNull: false,
        help: "The monthly monitoring record. ⟳ Sync sheets needs it, and the Water Parade Log is written into this workbook too. A pasted spreadsheet URL is accepted — the id is taken out of it.",
      },
      {
        column: "whatsapp_group_id",
        label: "WhatsApp group ID",
        kind: "groups",
        required: false,
        notNull: false,
        help: "Looks like 120363…@g.us.",
      },
      {
        column: "instance_name",
        label: "WhatsApp instance",
        kind: "text",
        required: false,
        notNull: false,
      },
      {
        column: "client_id",
        label: "Client ID",
        kind: "text",
        required: false,
        notNull: false,
      },
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
