import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";
import { noiseTableForProject } from "../naming";

/** Service-owned onboarding contract. Generic code validates and executes it. */
export const noiseOnboarding: OnboardDefinition = {
    service: "noise",
    // No CHECK on the column, but normalizeProjectCode() in the noise repo
    // rejects anything whose normalised form does not start with a letter.
    codePattern: /^[A-Za-z][A-Za-z0-9 _-]{0,47}$/,
    codeHelp: "Must start with a letter. Spaces and hyphens are fine — CR 106 becomes cr_106_noise_data_daily.",
    label: "＋ Add project",
    title: "Add a new Noise project",
    description:
      "Creates the project's readings table and one disabled config row. Limits are separate — this does not touch noise_limits.",
    outsideHalo: [
      "Import the project's limits into noise_limits — one row per meter, per hour band, per day type. Nothing is measured against anything until they exist, and this dialog deliberately does not invent them.",
      "Meter RecIDs are discovered by the scraper, so the meter names on the card only appear after a successful scrape.",
      "Share the analysis workbook with the service account as Editor. Bootstrap creates the tabs itself and sets column widths, which Viewer cannot do.",
    ],
    rpc: {
      fn: "ensure_project_readings_table",
      args: (projectCode) => ({ p_project_code: projectCode }),
      describes: "the project's readings table",
      expects: noiseTableForProject,
    },
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Also names the readings table, and must match the prefix of every full_identifier in noise_limits.",
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
        column: "source_type",
        label: "Login profile",
        kind: "text",
        required: false,
        notNull: true,
        fallback: "default",
        help: "Which NoiseLynx credentials the scraper uses: default, whgd or svs.",
      },
      {
        column: "google_sheet_id",
        label: "Analysis sheet ID",
        kind: "sheet",
        // Nullable, so not required — but both of this service's actions
        // (⤓ Bootstrap sheet, ⟳ Sync sheet) are gated on it, so a project
        // created without it cannot be worked on from the action row until
        // someone opens the editor. Offering it here saves that round trip.
        required: false,
        notNull: false,
        help: "The analysis workbook. Both sheet actions are unavailable until it is set. A pasted spreadsheet URL is accepted — the id is taken out of it.",
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
      { column: "whatsapp_group_id", label: "WhatsApp group ID", kind: "groups", required: false, notNull: false },
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
