import { deriveNeaRegion, withinServiceArea } from "./derive";
import type { ProjectConfigRow, ServiceKey } from "./services";

/**
 * Creating a project row from HALO, rather than editing one.
 *
 * Every other write in this app patches a row that already exists. Onboarding is
 * the one place HALO inserts, which brings two problems the editor never has:
 *
 * 1. **`NOT NULL` columns with nothing to put in them.** Five ailytics columns are
 *    `NOT NULL` — `telegram_chat_id`, `upstream_bot_username`, `instance_name`,
 *    `client_id`, `whatsapp_group_ids` — and are routinely unknown on day one.
 *    The service's own convention is the empty string, not NULL: CTM sits in the
 *    table today with `enabled = false` and a blank `upstream_bot_username`.
 * 2. **A composite unique key made of two of them.**
 *    `unique (telegram_chat_id, upstream_bot_username)` means at most one row can
 *    hold blanks in both. A second draft is a Postgres constraint violation, so it
 *    is checked here first and refused with something readable.
 *
 * Rows are always created disabled. The service's README prescribes exactly that —
 * insert disabled, validate, then flip `enabled` — and it is also the only safe
 * default when three of the fields may still be blank.
 */

/**
 * `groups` renders the same chat picker the editor uses — resolved group names,
 * searchable, and still accepting a pasted id the alias store has never seen.
 */
export type OnboardFieldKind = "text" | "sheet" | "number" | "groups";

export type OnboardField = {
  column: string;
  label: string;
  help?: string;
  kind: OnboardFieldKind;
  /** Whether the insert is refused without it. */
  required: boolean;
  /**
   * `NOT NULL` in Postgres, so an unknown must be written as "" rather than null.
   * Keeping this explicit stops a future edit "tidying up" blanks into nulls.
   */
  notNull: boolean;
  /** Computed from the draft, e.g. "(ZRA) CCTV History". */
  derive?: (draft: OnboardDraft, projectCode: string) => string;
  /** Numeric bounds, mirroring the column's CHECK constraint. */
  range?: { min: number; max: number };
  /**
   * Recomputed from the rest of the draft as it changes, and written into the
   * field — until someone edits it by hand, after which their value stands.
   *
   * For a value the service itself derives and then trusts forever, like haze's
   * `nea_region`, this is the honest shape: suggest it, show the reasoning, and
   * let a human overrule it. A `computed` field would be wrong here, because the
   * source repo explicitly supports an override.
   */
  autofill?: (draft: OnboardDraft) => { value: string; note: string; review: boolean } | null;
  /**
   * Derived and NOT editable. The server ignores whatever the client sends for
   * these, so a stale or hand-edited draft cannot put a mismatched tab name on a
   * row — the tab is created on demand from this exact string.
   */
  computed?: boolean;
  /**
   * Which table this field writes to. `companion` fields are collected in the
   * same form but must NOT reach the config insert — `wbgt_sensors.sensor_label`
   * is not a column of `wbgt_project_configs`, and sending it would fail the row.
   */
  target?: "config" | "companion";
  /** Env var supplying the default, resolved server-side. */
  envDefault?: string;
  /** Literal default. */
  fallback?: string;
};

export type OnboardDefinition = {
  service: ServiceKey;
  label: string;
  title: string;
  description: string;
  /** Steps HALO cannot do, shown in the dialog so they are not forgotten. */
  outsideHalo: string[];
  fields: OnboardField[];
  /**
   * The project-code rule this service actually enforces. Not shared: haze and
   * lightning both CHECK `^[A-Z0-9][A-Z0-9-]{0,47}$` — uppercase, hyphens, no
   * underscores — ailytics constrains nothing, and wbgt has no CHECK but derives
   * a table name that must start with a letter. One shared regex accepted codes
   * Postgres then rejected.
   */
  codePattern: RegExp;
  codeHelp: string;
  /** Columns forming a composite unique constraint, checked before insert. */
  uniqueTogether?: string[];
  /**
   * A `security definer` function to run before the config row is inserted.
   *
   * WBGT keeps one readings table per project, which is DDL and therefore out of
   * reach for PostgREST. The wbgt repo installs a narrow function for it; a 404
   * means that migration has not been run, which the dialog reports as a missing
   * prerequisite rather than a failed insert.
   */
  rpc?: {
    fn: string;
    /** Argument object, PostgREST style — named after the function's parameter. */
    args: (projectCode: string) => Record<string, unknown>;
    /** What it creates, for the dialog and the result panel. */
    describes: string;
    /** Table the function is expected to produce, for the readiness check. */
    expects: (projectCode: string) => string;
  };
  /** Rows written into a second table after the config row. */
  companion?: {
    table: string;
    label: string;
    onConflict: string;
    build: (draft: OnboardDraft, projectCode: string) => Record<string, unknown>[];
  };
};

/**
 * Mirrors `normalizeProjectCode` in the wbgt repo's `lib/naming.js`, and the
 * `normalize_wbgt_project_code` SQL function that shadows it. All three must
 * agree, or HALO would name a table the service cannot address.
 */
export function noiseTableForProject(projectCode: string): string {
  return `${normalizeCode(projectCode)}_noise_data_daily`;
}

/** Shared by both readings-table services; both repos normalise identically. */
function normalizeCode(projectCode: string): string {
  return String(projectCode)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function wbgtTableForProject(projectCode: string): string {
  const slug = String(projectCode)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${slug}_wbgt_data_hourly`;
}

/**
 * The tab names follow the `(CODE) …` convention TEST and ZRA use. Note this is
 * NOT the Postgres default (`cctv safety activity history`), and CTM predates the
 * convention — so the value is always written explicitly rather than left to the
 * column default.
 */
export const ONBOARDING: Partial<Record<ServiceKey, OnboardDefinition>> = {
  haze: {
    service: "haze",
    codePattern: /^[A-Z0-9][A-Z0-9-]{0,47}$/,
    codeHelp: "Uppercase letters, digits and hyphens only — the column CHECK rejects lowercase and underscores.",
    label: "＋ Add project",
    title: "Add a new Haze project",
    description:
      "Creates one disabled row in haze.haze_project_configs. Readings are shared per region, so there is nothing else to create.",
    outsideHalo: [
      "Confirm the derived NEA region against NEA's own regional map. HALO infers it from the coordinates, and the service then trusts the stored value forever — correcting the coordinates later will NOT move the project.",
      "Delivery cannot be half-configured: haze_enabled_delivery_check refuses enabled = true unless lambda_url, instance_name, client_id and the group list are all set, so fill them in before enabling.",
    ],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Uppercase. Enforced by a CHECK on the column.",
      },
      {
        column: "latitude",
        label: "Latitude",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 1.1, max: 1.5 },
        help: "Singapore only. Use the address lookup if you do not have coordinates.",
      },
      {
        column: "longitude",
        label: "Longitude",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 103.55, max: 104.15 },
      },
      {
        column: "site_address",
        label: "Site address",
        kind: "text",
        required: false,
        notNull: false,
        help: "Optional. Filled in by the address lookup.",
      },
      {
        column: "nea_region",
        label: "NEA region",
        kind: "text",
        required: true,
        notNull: true,
        help: "Derived from the coordinates as you type. Editable — an explicit value is trusted outright.",
        autofill: (draft) => {
          const derived = deriveNeaRegion(Number(draft.latitude), Number(draft.longitude));
          if (!derived) return null;
          return { value: derived.region, note: derived.note, review: derived.requiresManualReview };
        },
      },
      {
        column: "wa_group_ids",
        label: "WhatsApp group IDs",
        kind: "groups",
        required: false,
        notNull: false,
        help: "Comma-separated; one message per group.",
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
  },
  lightning: {
    service: "lightning",
    codePattern: /^[A-Z0-9][A-Z0-9-]{0,47}$/,
    codeHelp: "Uppercase letters, digits and hyphens only — the column CHECK rejects lowercase and underscores.",
    label: "＋ Add project",
    title: "Add a new Lightning project",
    description:
      "Creates one disabled row in lightning.lightning_project_configs. The two ring radii are client-approved and have no defaults.",
    outsideHalo: [
      "The red and amber radii are a client-approved safety decision, not a default — the repo's own wizard refuses to proceed without both. Confirm them before enabling.",
      "Remember that an uncertainty margin WIDENS the trigger ring, and site extent does too: the ring is measured from the site boundary. Both default to 0 here and can be set in the editor.",
    ],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Uppercase. Enforced by a CHECK on the column.",
      },
      {
        column: "latitude",
        label: "Latitude",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 1.1, max: 1.5 },
        help: "Singapore only. Use the address lookup if you do not have coordinates.",
      },
      {
        column: "longitude",
        label: "Longitude",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 103.55, max: 104.15 },
      },
      {
        column: "site_address",
        label: "Site address",
        kind: "text",
        required: false,
        notNull: false,
        help: "Optional. Filled in by the address lookup.",
      },
      {
        column: "red_radius_m",
        label: "Red radius (m)",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 1, max: 100000 },
        help: "Stop-work ring. Client-approved — there is deliberately no default.",
      },
      {
        column: "amber_radius_m",
        label: "Amber radius (m)",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 1, max: 100000 },
        help: "Warning ring. Usually wider than red; a narrower one is allowed but warns.",
      },
      {
        column: "site_extent_radius_m",
        label: "Site extent (m)",
        kind: "number",
        required: false,
        notNull: true,
        fallback: "0",
        range: { min: 0, max: 50000 },
        help: "Rings are measured from the site boundary, so this widens both.",
      },
      {
        column: "whatsapp_group_id",
        label: "WhatsApp group ID",
        kind: "groups",
        required: false,
        notNull: false,
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
  },
  noise: {
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
        column: "source_type",
        label: "Login profile",
        kind: "text",
        required: false,
        notNull: true,
        fallback: "default",
        help: "Which NoiseLynx credentials the scraper uses: default, whgd or svs.",
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
  },
  subcon: {
    service: "subcon",
    // The table has no CHECK on project_code and the code is not used to build an
    // identifier, so this is HALO's own conservative rule.
    codePattern: /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/,
    codeHelp: "Letters, digits, spaces, hyphen and underscore.",
    label: "＋ Add project",
    title: "Add a new Subcon Activities project",
    description:
      "Creates one row in manpower_activity.project_configs. Two routes: housekeeping intake, and the outbound morning activity + manpower summary.",
    outsideHalo: [
      "Share the manpower workbook with the service account as Editor. This service writes the `Daily Activity` tab and maintains `Activity and Manpower Daily`; the `Manpower` and `Machines` tabs belong to the base template.",
      "Fill in the source group IDs. They are the only thing that routes a message to this project: `client_identifier_number` names the company's listener client, several project codes share one, and the middleware already gates on it upstream. With no groups, intake is switched on and nothing arrives.",
      "Point the base template's forwarder at this service, and confirm the groups it forwards from are the ones listed here.",
      "The morning report needs a destination group as well as the send URL. With the group blank it stays switched on and delivers nothing.",
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
        column: "spreadsheet_id",
        label: "Manpower workbook",
        kind: "sheet",
        required: true,
        notNull: true,
        help: "Must already exist and be shared with the service account as Editor.",
      },
      {
        column: "client_identifier_number",
        label: "Source client identifier",
        kind: "text",
        required: false,
        notNull: false,
        // Not a project identifier: several project codes share one, because it
        // names the listener client, which is a company. Set on its own it
        // matches every site in that company. The middleware already gates on
        // it upstream, so leaving it blank is the normal case.
        help: "Optional, and not how routing works — it names the company's listener client, not this project. Leave blank unless you know why you are setting it.",
      },
      {
        column: "safety_group_ids",
        label: "Source group IDs",
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
  },

  issueChaser: {
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
        help: "Uppercase. Enforced by a CHECK on the column.",
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
  },
  wbgt: {
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
  },
  ailytics: {
    service: "ailytics",
    // No constraint on the column; this is HALO's own rule, kept conservative
    // because the code also names two Google Sheet tabs.
    codePattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/,
    codeHelp: "Letters, digits, hyphen and underscore.",
    label: "＋ Add project",
    title: "Add a new Ailytics project",
    description:
      "Creates one disabled row in ailytics.project_configs. Validate it, then enable it in the editor.",
    outsideHalo: [
      "Share the Google Sheet with the service account as Editor — it creates the tabs itself, and sets column widths, which Viewer cannot do.",
      "Add the thin WhatsApp forwarding adapter to the project's own Lambda (docs/AILYTICS_BASE_REPO_IMPLEMENTATION_GUIDE.md).",
    ],
    uniqueTogether: ["telegram_chat_id", "upstream_bot_username"],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Unique. Also used to name both sheet tabs.",
      },
      {
        column: "timezone",
        label: "Timezone",
        kind: "text",
        required: true,
        notNull: true,
        fallback: "Asia/Singapore",
      },
      {
        column: "spreadsheet_id",
        label: "Spreadsheet ID",
        kind: "sheet",
        required: true,
        notNull: true,
        help: "The workbook must already exist and be shared with the service account.",
      },
      {
        column: "activity_history_tab",
        computed: true,
        label: "Activity history tab",
        kind: "text",
        required: true,
        notNull: true,
        derive: (_draft, code) => `(${code}) CCTV History`,
        help: "Created automatically on first write if missing.",
      },
      {
        column: "safety_sheet_tab",
        computed: true,
        label: "Safety sheet tab",
        kind: "text",
        required: true,
        notNull: true,
        derive: (_draft, code) => `(${code}) CCTV Safety Sheet`,
      },
      {
        column: "telegram_chat_id",
        label: "Telegram chat ID",
        kind: "text",
        required: false,
        notNull: true,
        help: "Leave blank if unknown. Only one draft may be blank at a time — it is half of a unique key.",
      },
      {
        column: "upstream_bot_username",
        label: "Upstream bot username",
        kind: "text",
        required: false,
        notNull: true,
        help: "Leave blank if unknown. The other half of that unique key.",
      },
      {
        column: "expected_chat_title",
        label: "Expected chat title",
        kind: "text",
        required: false,
        notNull: false,
        help: "Informational only — matching uses the chat ID and bot username.",
      },
      {
        column: "instance_name",
        label: "WhatsApp instance",
        kind: "text",
        required: false,
        notNull: true,
      },
      {
        column: "client_id",
        label: "Client ID",
        kind: "text",
        required: false,
        notNull: true,
      },
      {
        column: "whatsapp_group_ids",
        label: "WhatsApp group IDs",
        kind: "groups",
        required: false,
        notNull: true,
        help: "Comma-separated.",
      },
      {
        column: "lambda_url",
        label: "Send-message URL",
        kind: "text",
        required: true,
        notNull: true,
        envDefault: "DEFAULT_LAMBDA_URL_SEND",
      },
      {
        column: "reply_lambda_url",
        label: "Reply-message URL",
        kind: "text",
        required: false,
        notNull: false,
        envDefault: "DEFAULT_LAMBDA_URL_REPLY",
      },
      {
        column: "lambda_url_image",
        label: "Send-document URL",
        kind: "text",
        required: false,
        notNull: false,
        envDefault: "DEFAULT_LAMBDA_URL_IMAGE",
        help: "Left blank, the service derives /send-document from the send-message URL.",
      },
    ],
  },
};

export function onboardingFor(service: ServiceKey): OnboardDefinition | null {
  return ONBOARDING[service] ?? null;
}

export type OnboardDraft = Record<string, string>;

/**
 * Everything wrong with a draft, rather than the first thing — one round trip
 * should tell someone the whole list.
 */
export function validateDraft(
  definition: OnboardDefinition,
  draft: OnboardDraft,
  existing: ProjectConfigRow[],
  /**
   * Env-backed defaults, so a required field with a server default does not read
   * as missing. The browser cannot see `process.env`, so it passes a stub built
   * from GET /api/onboard/<service> — presence is all this needs, never the value.
   */
  env: Record<string, string | undefined> = {},
): string[] {
  const problems: string[] = [];
  const value = (column: string) => String(draft[column] ?? "").trim();

  const code = value("project_code");
  if (!code) {
    problems.push("Project code is required.");
  } else if (!definition.codePattern.test(code)) {
    problems.push(`Project code is not valid for ${definition.service}: ${definition.codeHelp}`);
  } else if (existing.some((row) => String(row.project_code ?? "").toLowerCase() === code.toLowerCase())) {
    problems.push(`${code} already exists.`);
  }

  for (const field of definition.fields) {
    if (field.column === "project_code") continue;
    const resolved = resolveValue(field, draft, code, env).trim();
    if (field.required && !resolved) {
      problems.push(`${field.label} is required.`);
      continue;
    }
    // Range checks mirror the column CHECKs, so a value Postgres would reject is
    // caught here rather than surfacing as a constraint violation.
    if (resolved && field.kind === "number") {
      const value = Number(resolved);
      if (!Number.isFinite(value)) {
        problems.push(`${field.label} must be a number.`);
      } else if (field.range && (value < field.range.min || value > field.range.max)) {
        problems.push(`${field.label} must be between ${field.range.min} and ${field.range.max}.`);
      }
    }
  }

  // Coordinates are checked as a pair: one alone cannot be inside the service
  // area, and the CHECK constraints reject the row rather than the field.
  const hasCoords = definition.fields.some((field) => field.column === "latitude");
  if (hasCoords) {
    const lat = Number(value("latitude"));
    const lon = Number(value("longitude"));
    if (value("latitude") && value("longitude") && !withinServiceArea(lat, lon)) {
      problems.push("Latitude and longitude must fall inside Singapore — 1.10 to 1.50, 103.55 to 104.15.");
    }
  }

  // Pre-empt the composite unique key rather than surfacing a Postgres error.
  if (definition.uniqueTogether?.length) {
    const pair = definition.uniqueTogether.map((column) => value(column));
    const clash = existing.find((row) =>
      definition.uniqueTogether!.every(
        (column, index) => String(row[column] ?? "").trim() === pair[index],
      ),
    );
    if (clash) {
      const blank = pair.every((entry) => entry === "");
      problems.push(
        blank
          ? `${String(clash.project_code)} is already a draft with both ${definition.uniqueTogether.join(" and ")} blank. Postgres allows only one — fill one of them in, or finish ${String(clash.project_code)} first.`
          : `${String(clash.project_code)} already uses that ${definition.uniqueTogether.join(" + ")} pair.`,
      );
    }
  }

  return problems;
}

/**
 * The value a column ends up with: what was typed, else the env default, else the
 * derived name, else the literal fallback.
 */
export function resolveValue(
  field: OnboardField,
  draft: OnboardDraft,
  projectCode: string,
  env: Record<string, string | undefined>,
): string {
  // A computed field is derived from the project code, whatever the draft says.
  if (field.computed) return field.derive && projectCode ? field.derive(draft, projectCode) : "";
  const typed = String(draft[field.column] ?? "").trim();
  if (typed) return typed;
  if (field.envDefault && env[field.envDefault]) return String(env[field.envDefault]).trim();
  if (field.derive && projectCode) return field.derive(draft, projectCode);
  if (field.fallback) return field.fallback;
  return "";
}

/**
 * The row to insert.
 *
 * A blank `NOT NULL` column becomes "", a blank nullable column becomes null —
 * the distinction the service itself draws, and the reason a draft row is legal.
 * `enabled` is always false and is not settable from here.
 */
export function buildInsertRow(
  definition: OnboardDefinition,
  draft: OnboardDraft,
  env: Record<string, string | undefined> = {},
): Record<string, unknown> {
  const code = String(draft.project_code ?? "").trim();
  const row: Record<string, unknown> = { enabled: false };
  for (const field of definition.fields) {
    if (field.target === "companion") continue;
    const value = resolveValue(field, draft, code, env);
    row[field.column] = value ? value : field.notNull ? "" : null;
  }
  return row;
}

/**
 * The values the dialog should prefill, resolved server-side.
 *
 * Real values rather than "comes from an env var": someone approving a new row
 * should see the URL it will carry. These are already visible in the editor for
 * every existing project, so this exposes nothing new to an authorised session.
 */
export function prefillDefaults(
  definition: OnboardDefinition,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of definition.fields) {
    if (field.computed || field.target === "companion") continue;
    const value = field.envDefault ? (env[field.envDefault] ?? "") : (field.fallback ?? "");
    if (value) out[field.column] = String(value).trim();
  }
  return out;
}

/** Env defaults that are declared but unset, so the dialog can say so up front. */
export function missingEnvDefaults(
  definition: OnboardDefinition,
  env: Record<string, string | undefined>,
): string[] {
  return definition.fields
    .filter((field) => field.envDefault && !env[field.envDefault])
    .map((field) => field.envDefault as string);
}
