import type { ServiceKey } from "../services";

export type OnboardDraft = Record<string, string>;

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
   * Written on insert, and kept out of the dialog's primary list.
   *
   * For a value that has one sensible answer nobody needs to be asked for, and
   * where relying on the column default is not safe: HALO writes it
   * explicitly. `feed_stale_after_seconds` is exactly that case — setup.sql
   * says 600 and the live column default is 360, so an omitted field would
   * silently produce the wrong number.
   *
   * It used to mean "never rendered", which quietly broke the rule
   * `withSchemaFields` exists to keep: all twenty-two of these are editable
   * the moment the row exists, so refusing to show them at creation only meant
   * creating the row and immediately editing it. They now render alongside the
   * rest of the table, prefilled with the value HALO would have written — the
   * stated default is still stated, and it is also changeable.
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
  /**
   * Added from the live schema rather than written here — see
   * `withSchemaFields`.
   *
   * The one behavioural difference: left blank, it is OMITTED from the insert
   * instead of written as null, so the column's own default applies. A curated
   * field is one somebody thought about, and writing null for it is a
   * decision; a column nobody named in this file has a default for a reason,
   * and overwriting it with null would be an accident — several are NOT NULL
   * with a default, where null is a constraint violation rather than a blank.
   */
  fromSchema?: boolean;
  /**
   * What the COLUMN defaults to, for a `fromSchema` field left blank.
   *
   * Not a `fallback`: a fallback is written, and these are deliberately
   * omitted from the insert so the database's own default applies. It exists
   * because the two can disagree with each other in a way nobody sees.
   * `manpower_activity.project_configs.enable_activity_summary` is `default
   * true` live while the repo's setup.sql says `false`, so the dialog drew an
   * off switch for a column that stores on — the form said one thing and the
   * row said another.
   */
  schemaDefault?: string;
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
   * Columns Postgres refuses to see set while the row is disabled.
   *
   * Rows are ALWAYS created disabled, so these can never be true at creation —
   * `issue_chaser_feature_requires_enabled_check` says
   * `not (a or b or c or d) or enabled`, and the insert fails with a bare
   * 23514 quoting a truncated row. Declared here so the dialog and the plan
   * say the useful thing instead: set them once the project is turned on.
   *
   * Mirrored from the service's own migration, like `codePattern` and the
   * range checks. Getting it wrong costs a failed insert, never bad data.
   */
  requiresEnabled?: string[];
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
