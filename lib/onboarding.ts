import { deriveNeaRegion, withinServiceArea } from "./derive";
import { COMPANIES } from "./field-spec";
import { readSheetId } from "./jobs";
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
/**
 * `multi` is a Postgres array column (lightning's strike types). Typed as a
 * comma list and written as a real array — `buildInsertRow` converts it, the way
 * `coerceValue` does on the editor's PATCH path. Sending the bare string "G" to a
 * `text[]` column is rejected by PostgREST.
 */
export type OnboardFieldKind =
  | "text"
  | "sheet"
  | "number"
  | "groups"
  | "multi"
  /** A boolean column. Held in the draft as "true"/"false", written as a real boolean. */
  | "toggle"
  /**
   * A fixed set of values — a pg enum, or a CHECK the introspection cannot see.
   * `options` carries them, and validateDraft refuses anything else.
   */
  | "select"
  /** `HHMM`, validated against the same pattern the column CHECKs use. */
  | "hhmm";

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
  /**
   * Written on insert but never rendered.
   *
   * For a value that has one sensible answer nobody needs to be asked for, and
   * where relying on the column default is not safe: HALO writes it explicitly.
   * `feed_stale_after_seconds` is exactly that case — setup.sql says 600 and the
   * live column default is 360, so an omitted field would silently produce the
   * wrong number.
   */
  hidden?: boolean;
  /** Numeric bounds, mirroring the column's CHECK constraint. */
  range?: { min: number; max: number };
  /**
   * Permitted values for a `multi` or `select` field, mirroring the column's
   * CHECK or pg enum. An empty string is always allowed for a nullable select —
   * that is how "leave it unset" is expressed.
   */
  options?: string[];
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
      // Cadence and wording, offered here rather than left to the editor: these
      // are the questions asked when a site is onboarded, and every one of them
      // has a default that is a real decision.
      {
        column: "four_hourly",
        label: "Four-hourly override (now every 2 hours)",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "Guarantees a send every two hours — 08, 10, 12, 14, 16, 18 and 20 SGT — on top of the hourly advisory, ignoring both the floor below and the working-hours window. Seven slots despite the column name, which was left alone when the interim widening landed. Every other hour follows the ordinary rules.",
      },
      {
        column: "alert_only_when_at_least",
        label: "Alert only when at least",
        kind: "select",
        required: false,
        notNull: false,
        // Blank is the historical default and means every band sends. `good` is
        // the lowest band, so choosing it is the same thing said louder.
        options: ["", "good", "moderate", "unhealthy", "very_unhealthy", "hazardous"],
        help: "Suppresses the hourly advisory below this band. Unset sends every hour; `good` is the lowest band, so it is identical to unset.",
      },
      {
        column: "advisory_format",
        label: "Advisory format",
        kind: "select",
        required: false,
        notNull: true,
        fallback: "default",
        options: ["default", "wohhup"],
        help: "`wohhup` renders the house wording. An unrecognised value throws at run time rather than falling back, which is why this is a fixed list.",
      },
      {
        column: "working_hours_start_hhmm",
        label: "Working hours start",
        kind: "hhmm",
        hidden: true,
        required: false,
        notNull: false,
        fallback: "0800",
        help: "HHMM, e.g. 0800. Both ends or neither — one alone means no window at all.",
      },
      {
        column: "working_hours_end_hhmm",
        label: "Working hours end",
        kind: "hhmm",
        hidden: true,
        required: false,
        notNull: false,
        fallback: "1900",
        help: "Exclusive. An end at or before the start is an overnight window, not an empty one.",
      },
      {
        column: "remove_sunday_notifications",
        label: "Mute Sundays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Outbound only — ingestion and evaluation continue. On by default for a new project; turn it off in the editor for a site that works Sundays.",
      },
      {
        column: "remove_ph_notifications",
        label: "Mute public holidays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Same, for the hard-coded Singapore holiday list, which currently ends on 2027-12-25.",
      },
      // Mentions. Three columns that only work together, which is exactly why
      // they belong on one screen rather than being found one at a time in the
      // editor: the flag alone tags nobody, and an empty group list is
      // fail-closed however well the rest is filled in.
      {
        column: "enable_poc_mentions",
        label: "POC mentions",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "Tags the numbers below once the band is high enough. Needs a group list as well — empty means nobody is mentioned anywhere.",
      },
      {
        column: "poc_mentions_at_least",
        label: "Mention from band",
        kind: "select",
        required: false,
        notNull: false,
        options: ["", "good", "moderate", "unhealthy", "very_unhealthy", "hazardous"],
        help: "Lowest band that triggers a mention. Checked independently of the alert floor above, so a mention floor below it can never fire — the message it would ride on is not sent.",
      },
      {
        column: "poc_phone_numbers",
        label: "POC phone numbers",
        kind: "text",
        required: false,
        notNull: false,
        help: "Digits only, comma-separated, international without the +. e.g. 6591234567.",
      },
      {
        column: "poc_alert_wa_groups",
        label: "POC mention groups",
        kind: "groups",
        required: false,
        notNull: false,
        help: "Which groups get the mentions. Fail-closed: empty means none of them do, even with the flag on and numbers stored.",
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
        hidden: true,
        required: false,
        notNull: true,
        fallback: "0",
        range: { min: 0, max: 50000 },
        help: "Rings are measured from the site boundary, so this widens both. Written as 0; set it in the editor for a site whose extent matters.",
      },
      {
        column: "red_detection_types",
        label: "🔴 Red strike types",
        kind: "multi",
        required: false,
        notNull: true,
        fallback: "G",
        options: ["G", "C"],
        help: "G = cloud-to-ground, C = intra-cloud. Ground-only by default; adding C makes a stop fire on cloud-to-cloud activity too.",
      },
      {
        column: "amber_detection_types",
        label: "🟠 Amber strike types",
        kind: "multi",
        required: false,
        notNull: true,
        // The column's own default is {C,G}. Prefilled as G here so a new project
        // starts on ground strikes for both tiers and widening is a decision
        // someone makes rather than inherits.
        fallback: "G",
        options: ["G", "C"],
        help: "Ground-only to start with, matching red. The column's own default is C,G — widen it here or in the editor once the site wants cloud activity to raise a watch.",
      },
      {
        column: "feed_stale_after_seconds",
        label: "Feed stale after (s)",
        kind: "number",
        // Hidden but still written: the live column default is 360 while
        // setup.sql says 600, so leaving it out would quietly onboard a project
        // onto a six-minute staleness window nobody chose.
        hidden: true,
        required: false,
        notNull: true,
        fallback: "600",
        range: { min: 60, max: 86400 },
        help: "Ten minutes. Past this the feed counts as stale and the state goes DEGRADED — which never downgrades an open STOP.",
      },
      {
        column: "amber_enabled",
        label: "Amber alerts",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "true",
        help: "Off is not a mute: amber detections are not evaluated at all, and a stop then clears straight to SAFE with no intermediate WATCH.",
      },
      {
        column: "red_dwell_seconds",
        label: "🔴 Red dwell (s)",
        kind: "number",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "1200",
        range: { min: 1, max: 86400 },
        help: "How long the stop persists after the last qualifying detection. Twenty minutes by default.",
      },
      {
        column: "amber_dwell_seconds",
        label: "🟠 Amber dwell (s)",
        kind: "number",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "1200",
        range: { min: 1, max: 86400 },
        help: "Also the amber debounce: a new amber waits at least this long after the last one, so a storm edge crossing the ring does not ping-pong.",
      },
      {
        column: "working_hours_start_hhmm",
        label: "Working hours start",
        kind: "hhmm",
        hidden: true,
        required: false,
        notNull: false,
        fallback: "0800",
        help: "HHMM, e.g. 0800. Both ends or neither.",
      },
      {
        column: "working_hours_end_hhmm",
        label: "Working hours end",
        kind: "hhmm",
        hidden: true,
        required: false,
        notNull: false,
        fallback: "1900",
      },
      {
        column: "remove_sunday_notifications",
        label: "Mute Sundays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Outbound only, and it never mutes the green that closes an open stop — nobody is left under a communicated stop-work instruction by a calendar setting. On by default for a new project.",
      },
      {
        column: "remove_ph_notifications",
        label: "Mute public holidays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Same, for the hard-coded holiday list, which runs out at the end of 2027.",
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
        label: "Housekeeping intake",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "true",
        help: "The inbound route: forwarded housekeeping messages are accepted and recorded. Independent of the two summaries, and it does not gate the nightly housekeeping report.",
      },
      {
        column: "enable_manpower_summary",
        label: "Manpower + machines report",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "POST /daily-manpower-summary — the plain per-company headcount, which also reads the `Machines` tab. Explicit opt-in: off means it is never sent.",
      },
      {
        column: "enable_activity_summary",
        label: "Activity + manpower report",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "POST /daily-activity-summary — the morning activity/manpower message. Independent of the report above; either can run without the other.",
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
        help: "Same, for the Singapore holiday list in the service's `lib/time.js`, which currently ends on 2027-12-25.",
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
    if (resolved && field.kind === "select" && field.options && !field.options.includes(resolved)) {
      problems.push(`${field.label}: "${resolved}" is not one of ${field.options.join(", ")}.`);
    }
    if (resolved && field.kind === "toggle" && resolved !== "true" && resolved !== "false") {
      problems.push(`${field.label} must be true or false.`);
    }
    if (resolved && field.kind === "hhmm" && !/^([01][0-9]|2[0-3])[0-5][0-9]$/.test(resolved)) {
      problems.push(`${field.label} must be a 24-hour HHMM time, e.g. 0800.`);
    }
    if (resolved && field.kind === "multi" && field.options) {
      const bad = resolved
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => !field.options!.includes(entry));
      if (bad.length) {
        problems.push(`${field.label}: ${bad.join(", ")} — allowed values are ${field.options.join(", ")}.`);
      }
    }
    // A sheet id Postgres would happily store but Google would reject. Caught
    // here because the failure is otherwise a cron-time Sheets error on a
    // project nobody is watching yet.
    if (resolved && field.kind === "sheet" && !readSheetId(resolved)) {
      problems.push(
        `${field.label} does not look like a Google Sheet id. Paste the sheet's URL, or the id from it — the long string between /d/ and /edit.`,
      );
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

  // The working-hours window is both-or-neither in the database, and one end
  // alone is silently treated as no window at all by the services. Caught here
  // so the dialog does not offer a half-window that looks like a restriction.
  const start = value("working_hours_start_hhmm");
  const end = value("working_hours_end_hhmm");
  if (definition.fields.some((field) => field.column === "working_hours_start_hhmm")) {
    if (Boolean(start) !== Boolean(end)) {
      problems.push("Working hours need both ends, or neither — one alone means no window at all.");
    } else if (start && start === end) {
      problems.push("Working hours cannot start and end at the same time.");
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
  if (typed) {
    // Pasting the browser's address bar is the natural gesture for a sheet
    // field, and every service wants the bare id — a stored URL fails at the
    // Sheets API, far from here. `readSheetId` is the same extraction HALO's
    // job preconditions use, so the two cannot disagree. An unparseable value
    // is returned untouched, for validateDraft to reject with a reason.
    if (field.kind === "sheet") return readSheetId(typed) ?? typed;
    return typed;
  }
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
    if (field.kind === "toggle") {
      // A boolean column, so write a boolean. "false" as a string is truthy in
      // enough places that sending it would be asking for trouble.
      row[field.column] = value === "true";
      continue;
    }
    if (field.kind === "multi") {
      // An empty list stays an empty array rather than "" or null, so a
      // cardinality CHECK reports the real reason instead of a type error.
      row[field.column] = value
        ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [];
      continue;
    }
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
