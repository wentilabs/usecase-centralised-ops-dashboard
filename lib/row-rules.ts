import type { ServiceKey } from "./services";

/**
 * The multi-column CHECK constraints, in a form HALO can evaluate.
 *
 * These are the rules a single field cannot express: "red mentions needs both
 * lists non-empty", "a summary needs somewhere to send it", "both ends of a
 * window or neither". Postgres enforces every one of them, and until now that
 * was the only thing that did — so the way an operator met one was:
 *
 *   Supabase rejected the change: new row for relation "lightning_project_configs"
 *   violates check constraint "lightning_red_poc_mentions_check" — Failing row
 *   contains (JCU, 2 Jurong East Central 1, 1.333435, 103.740261, 0, 3000, {G},
 *   1200, 6000, {G}, 1200, 0, 0, 600, 3, https://3ibx8cveia.execute-api.ap-s… [23514]
 *
 * after clicking save, with nothing on screen saying which field was wrong.
 * HALO already knew the rule — the help text under that very toggle says
 * "Postgres requires BOTH lists below to be non-empty before this can be
 * turned on" — it simply had no way to act on knowing.
 *
 * Now it does, in both directions. `rowProblems` runs the rules over the row
 * as it would be saved, so the editor can name the fields before the request
 * leaves the browser; `explainConstraint` maps a constraint name back to the
 * same sentence, for the case where Postgres rejects something this file has
 * not mirrored or has mirrored wrongly.
 *
 * **This is a mirror, and mirrors drift.** It is the same bargain already made
 * by `CHECK_ENUMS`, `codePattern` and the range checks: getting one wrong
 * costs a rejected save, never bad data, because the database still has the
 * last word. Each rule names the constraint it copies so the original is one
 * grep away in the service repo.
 */
export type RowRule = {
  /** The Postgres constraint this mirrors. Used to translate a rejection. */
  constraint: string;
  /** Columns the rule is about, so the editor can point at them. */
  columns: string[];
  /**
   * What is wrong and what to do about it, or null when the row is fine.
   *
   * `label` renders a column the way the screen does, so the sentence says
   * "POC mention groups" rather than `poc_alert_wa_groups` and cannot drift
   * from the form beside it.
   */
  check: (row: Row, label: (column: string) => string, where?: Where) => string | null;
  /**
   * What to say if Postgres raises this constraint anyway.
   *
   * For a constraint HALO deliberately does not pre-empt — one being dropped
   * upstream, or one whose presence depends on which migrations a database
   * has run. `check` returns null so nothing is blocked here, and this is used
   * only when the database actually refuses the write.
   */
  explain?: string;
};

type Row = Record<string, unknown>;

/**
 * Which screen is asking, because the remedy differs and only the remedy does.
 *
 * "Turn the project on in the same save" is right in the editor and wrong in
 * the create dialog, where every row is created disabled by rule. The rule
 * being broken is identical; what to do about it is not.
 */
export type Where = "editing" | "creating";

/** A text column that is null, absent, or only whitespace. */
function blank(row: Row, column: string): boolean {
  return !String(row[column] ?? "").trim();
}

/** A boolean column that is on. Accepts the string form a draft holds. */
function on(row: Row, column: string): boolean {
  const value = row[column];
  return value === true || value === "true";
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * "X needs A and B" — the shape most of these constraints have.
 *
 * Names only the columns that are actually empty, because "needs a group and
 * a phone number" when you have supplied the phone number reads as though
 * HALO cannot see it.
 */
function requires(
  trigger: string,
  needed: string[],
  { whenOff }: { whenOff?: string } = {},
): RowRule["check"] {
  return (row, label) => {
    if (!on(row, trigger)) return null;
    const missing = needed.filter((column) => blank(row, column));
    if (!missing.length) return null;
    return (
      `${label(trigger)} is on, so ${list(missing.map(label))} ` +
      `${missing.length === 1 ? "cannot be" : "cannot be"} empty. ` +
      `Fill ${missing.length === 1 ? "it" : "them"} in before saving${whenOff ? `, or ${whenOff}` : ""}.`
    );
  };
}

/** Both ends of a window, or neither — and never the same instant. */
function window(start: string, end: string, what: string): RowRule["check"] {
  return (row, label) => {
    const from = String(row[start] ?? "").trim();
    const to = String(row[end] ?? "").trim();
    if (!from && !to) return null;
    if (!from || !to) {
      return (
        `${what} needs both ends or neither — ${label(from ? end : start)} is empty. ` +
        `One end alone means no window at all, so the database refuses it.`
      );
    }
    if (from === to) {
      return `${what} starts and ends at the same time (${from}), which is an empty window rather than a full day.`;
    }
    return null;
  };
}

/** Enabling a project requires everything it needs to actually deliver. */
function delivery(needed: { column: string; wrong: (value: string) => boolean; say: string }[]): RowRule["check"] {
  return (row, label) => {
    if (!on(row, "enabled")) return null;
    const bad = needed.filter((entry) => entry.wrong(String(row[entry.column] ?? "").trim()));
    if (!bad.length) return null;
    return (
      `An enabled project has to be able to send. ` +
      bad.map((entry) => `${label(entry.column)} ${entry.say}`).join("; ") +
      `. Fix ${bad.length === 1 ? "it" : "them"}, or turn the project off while you finish setting it up.`
    );
  };
}

const empty = (value: string) => !value;

export const ROW_RULES: Partial<Record<ServiceKey, RowRule[]>> = {
  lightning: [
    {
      // lightning_red_poc_mentions_check
      constraint: "lightning_red_poc_mentions_check",
      columns: ["enable_red_band_poc_mentions", "poc_phone_numbers", "poc_alert_wa_groups"],
      check: requires("enable_red_band_poc_mentions", ["poc_phone_numbers", "poc_alert_wa_groups"], {
        whenOff: "turn Red POC mentions off",
      }),
    },
    {
      constraint: "lightning_working_hours_check",
      columns: ["working_hours_start_hhmm", "working_hours_end_hhmm"],
      check: window("working_hours_start_hhmm", "working_hours_end_hhmm", "Working hours"),
    },
    {
      constraint: "lightning_enabled_delivery_check",
      columns: ["enabled", "lambda_url", "instance_name", "client_id", "whatsapp_group_id"],
      check: delivery([
        { column: "lambda_url", wrong: (v) => !/^https:\/\//.test(v), say: "must be an https:// URL" },
        { column: "instance_name", wrong: empty, say: "is empty" },
        { column: "client_id", wrong: empty, say: "is empty" },
        { column: "whatsapp_group_id", wrong: empty, say: "has no group" },
      ]),
    },
  ],
  haze: [
    {
      constraint: "haze_working_hours_check",
      columns: ["working_hours_start_hhmm", "working_hours_end_hhmm"],
      check: window("working_hours_start_hhmm", "working_hours_end_hhmm", "Working hours"),
    },
    {
      constraint: "haze_enabled_delivery_check",
      columns: ["enabled", "lambda_url", "instance_name", "client_id", "wa_group_ids"],
      check: delivery([
        { column: "lambda_url", wrong: (v) => !/^https:\/\//.test(v), say: "must be an https:// URL" },
        { column: "instance_name", wrong: empty, say: "is empty" },
        { column: "client_id", wrong: empty, say: "is empty" },
        { column: "wa_group_ids", wrong: empty, say: "has no groups" },
      ]),
    },
  ],
  issueChaser: [
    {
      /**
       * Declared, but deliberately not enforced here.
       *
       * The constraint said a feature flag could only be on while `enabled`
       * was true, which meant turning a project off required turning five
       * flags off first and turning it back on required setting them all
       * again. The service never needed it: `isFeatureEnabled` in the repo's
       * config/index.js is `config.enabled && config[column]`, so a disabled
       * project with every flag on sends exactly nothing either way.
       *
       * Dropped from the database on request (11 Sep 2026). `check` returns
       * null so HALO blocks nothing; `explain` covers the window before the
       * DROP has been run against a given database, where the write still
       * fails and the reason is otherwise a constraint name.
       */
      constraint: "issue_chaser_feature_requires_enabled_check",
      columns: [],
      check: () => null,
      explain:
        "This database still has issue_chaser_feature_requires_enabled_check, which only allows a feature " +
        "flag on an enabled project. Run `alter table issue_chaser.project_configs drop constraint if exists " +
        "issue_chaser_feature_requires_enabled_check;` — the service gates every feature on `enabled` at run " +
        "time anyway, so nothing sends while the project is off.",
    },
    {
      // issue_chaser_summary_destination_check — two independent clauses, so
      // two sentences rather than one that names four columns at once.
      constraint: "issue_chaser_summary_destination_check",
      columns: [
        "daily_safety_summary_enabled",
        "daily_safety_company_summary_enabled",
        "novade_name_list_check_enabled",
        "safety_summary_whatsapp_group_ids",
        "novade_name_list_check_whatsapp_group_ids",
        "whatsapp_group_ids",
      ],
      check: (row, label) => {
        const said: string[] = [];
        const summaries = ["daily_safety_summary_enabled", "daily_safety_company_summary_enabled"].filter((column) =>
          on(row, column),
        );
        if (
          summaries.length &&
          blank(row, "safety_summary_whatsapp_group_ids") &&
          blank(row, "whatsapp_group_ids")
        ) {
          said.push(
            `${list(summaries.map(label))} needs somewhere to go: fill in ` +
              `${label("safety_summary_whatsapp_group_ids")}, or ${label("whatsapp_group_ids")} as the fallback.`,
          );
        }
        if (
          on(row, "novade_name_list_check_enabled") &&
          blank(row, "novade_name_list_check_whatsapp_group_ids") &&
          blank(row, "whatsapp_group_ids")
        ) {
          said.push(
            `${label("novade_name_list_check_enabled")} needs somewhere to go: fill in ` +
              `${label("novade_name_list_check_whatsapp_group_ids")}, or ${label("whatsapp_group_ids")} as the fallback.`,
          );
        }
        return said.length ? said.join(" ") : null;
      },
    },
    {
      constraint: "issue_chaser_p1_window_check",
      columns: ["severity_p1_window_start", "severity_p1_window_end"],
      check: window("severity_p1_window_start", "severity_p1_window_end", "The P1 send window"),
    },
    {
      constraint: "issue_chaser_p2_p3_window_check",
      columns: ["severity_p2_p3_window_start", "severity_p2_p3_window_end"],
      check: window("severity_p2_p3_window_start", "severity_p2_p3_window_end", "The P2/P3 send window"),
    },
    {
      constraint: "issue_chaser_summary_days_check",
      columns: ["summary_days"],
      check: (row, label) =>
        Number(row.summary_days ?? 1) >= 1
          ? null
          : `${label("summary_days")} has to be at least 1 — a summary covering zero days sends nothing.`,
    },
    {
      constraint: "issue_chaser_snapshot_lookback_check",
      columns: ["include_days_before_snapshot"],
      check: (row, label) =>
        Number(row.include_days_before_snapshot ?? 0) >= 0
          ? null
          : `${label("include_days_before_snapshot")} cannot be negative.`,
    },
    {
      constraint: "issue_chaser_enabled_delivery_check",
      columns: [
        "enabled",
        "safety_sheet_id",
        "lambda_url",
        "instance_name",
        "client_id",
        "whatsapp_group_ids",
        "send_to_originating_groups",
      ],
      check: (row, label) => {
        if (!on(row, "enabled")) return null;
        const bad: string[] = [];
        if (blank(row, "safety_sheet_id")) bad.push(`${label("safety_sheet_id")} is empty`);
        if (!/^https:\/\/.+\/send-message$/.test(String(row.lambda_url ?? "").trim())) {
          bad.push(`${label("lambda_url")} must be an https:// URL ending in /send-message`);
        }
        if (blank(row, "instance_name")) bad.push(`${label("instance_name")} is empty`);
        if (blank(row, "client_id")) bad.push(`${label("client_id")} is empty`);
        if (blank(row, "whatsapp_group_ids") && !on(row, "send_to_originating_groups")) {
          bad.push(
            `there is nowhere to send — fill in ${label("whatsapp_group_ids")} or turn on ` +
              `${label("send_to_originating_groups")}`,
          );
        }
        if (!bad.length) return null;
        return (
          `An enabled project has to be able to send. ${bad.join("; ")}. ` +
          `Fix ${bad.length === 1 ? "it" : "them"}, or turn the project off while you finish setting it up.`
        );
      },
    },
  ],
  wbgt: [
    // `wbgt_project_configs_water_parade_single_group` deliberately has no rule.
    // It forbade a comma, and migrate_water_parade_multiple_groups.sql drops
    // it — the service sends one reminder per group now, each with its own
    // delivery row and outbound message id. Probed against the live database
    // on the wbgt TEST fixture: a two-group value is accepted. A rule here
    // would block a save the database allows, which is the one failure mode a
    // mirror must not have.
    {
      constraint: "wbgt_project_configs_authoritative_client_digits",
      columns: ["whatsapp_authoritative_client_identifier"],
      check: (row, label) => {
        const value = String(row.whatsapp_authoritative_client_identifier ?? "").trim();
        if (!value || /^[0-9]{8,15}$/.test(value)) return null;
        return (
          `${label("whatsapp_authoritative_client_identifier")} must be 8 to 15 digits with nothing else — ` +
          `no +, no spaces, no @s.whatsapp.net.`
        );
      },
    },
  ],
};

export type RowProblem = { constraint: string; columns: string[]; message: string };

/**
 * Every rule this row would break, evaluated against the row as it will be
 * saved — not against the change-set, because these rules are about
 * combinations and half of each combination is usually a field nobody touched.
 */
export function rowProblems(
  service: ServiceKey,
  row: Row,
  label: (column: string) => string = (column) => column,
  where: Where = "editing",
): RowProblem[] {
  const problems: RowProblem[] = [];
  for (const rule of ROW_RULES[service] ?? []) {
    const message = rule.check(row, label, where);
    if (message) problems.push({ constraint: rule.constraint, columns: rule.columns, message });
  }
  return problems;
}

/**
 * Only the rules THIS edit breaks.
 *
 * Postgres enforces all of these on write, so a stored row satisfies them —
 * except where a constraint was added to a table that already had rows, which
 * has happened here more than once. Blocking an unrelated edit on a violation
 * the operator did not cause, and cannot see the cause of, would make the
 * editor unusable for exactly the rows that most need editing. So a problem
 * that was already true before the change is left alone.
 */
export function newProblems(
  service: ServiceKey,
  before: Row,
  after: Row,
  label: (column: string) => string = (column) => column,
): RowProblem[] {
  const already = new Set(rowProblems(service, before, label).map((problem) => problem.constraint));
  return rowProblems(service, after, label).filter((problem) => !already.has(problem.constraint));
}

/**
 * The rule behind a constraint name Postgres just quoted back at us.
 *
 * Matched by substring because the message embeds the name in prose, and
 * different Postgres versions word the rest of it differently.
 */
export function explainConstraint(
  service: ServiceKey,
  postgresMessage: string,
): RowRule | null {
  for (const rule of ROW_RULES[service] ?? []) {
    if (postgresMessage.includes(rule.constraint)) return rule;
  }
  return null;
}
