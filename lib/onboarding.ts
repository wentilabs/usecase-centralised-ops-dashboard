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

export type OnboardFieldKind = "text" | "sheet";

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
  /** Computed from the project code, e.g. "(ZRA) CCTV History". */
  derive?: (projectCode: string) => string;
  /**
   * Derived and NOT editable. The server ignores whatever the client sends for
   * these, so a stale or hand-edited draft cannot put a mismatched tab name on a
   * row — the tab is created on demand from this exact string.
   */
  computed?: boolean;
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
  /** Columns forming a composite unique constraint, checked before insert. */
  uniqueTogether?: string[];
};

/**
 * The tab names follow the `(CODE) …` convention TEST and ZRA use. Note this is
 * NOT the Postgres default (`cctv safety activity history`), and CTM predates the
 * convention — so the value is always written explicitly rather than left to the
 * column default.
 */
export const ONBOARDING: Partial<Record<ServiceKey, OnboardDefinition>> = {
  ailytics: {
    service: "ailytics",
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
        derive: (code) => `(${code}) CCTV History`,
        help: "Created automatically on first write if missing.",
      },
      {
        column: "safety_sheet_tab",
        computed: true,
        label: "Safety sheet tab",
        kind: "text",
        required: true,
        notNull: true,
        derive: (code) => `(${code}) CCTV Safety Sheet`,
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
        kind: "text",
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

/** Project codes are used as sheet-tab names, so keep them boring. */
const PROJECT_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;

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
  } else if (!PROJECT_CODE.test(code)) {
    problems.push("Project code may use letters, digits, hyphen and underscore only.");
  } else if (existing.some((row) => String(row.project_code ?? "").toLowerCase() === code.toLowerCase())) {
    problems.push(`${code} already exists.`);
  }

  for (const field of definition.fields) {
    if (field.column === "project_code") continue;
    if (field.required && !resolveValue(field, draft, code, env).trim()) {
      problems.push(`${field.label} is required.`);
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
  if (field.computed) return field.derive && projectCode ? field.derive(projectCode) : "";
  const typed = String(draft[field.column] ?? "").trim();
  if (typed) return typed;
  if (field.envDefault && env[field.envDefault]) return String(env[field.envDefault]).trim();
  if (field.derive && projectCode) return field.derive(projectCode);
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
    if (field.computed) continue;
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
