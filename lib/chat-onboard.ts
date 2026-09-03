import { companyIn } from "./chat-scope";
import { serviceHintsIn } from "./chat-intent";
import {
  onboardingFor,
  prefillDefaults,
  validateDraft,
  type OnboardDefinition,
  type OnboardDraft,
} from "./onboarding";
import { absentFrom, fold, type Cluster } from "./project-identity";
import { SERVICES, type ProjectConfigRow, type ServiceKey } from "./services";

/**
 * Turn "onboard every Wohhup project into issue chaser" into a reviewable list
 * of rows to create.
 *
 * No model is involved, deliberately. Every part of the request is decidable in
 * code: the company from `companyIn`, the target services from
 * `serviceHintsIn`, and which sites are missing from the identity map — so
 * there is no path by which a model could invent a project code that then gets
 * created in a live service. That is the same line `chat-scope` draws for bulk
 * edits, and it matters more here, because an edit to the wrong row is
 * correctable and a created row is a new project someone has to find and delete.
 *
 * The identity map is what makes this safe to offer at all. Asking for "every
 * Wohhup project" by code would create 44 rows for 37 sites, because the estate
 * spells nine of them differently per service — `CFC` in three services and
 * `Clifford Centre` in a fourth. Counting sites rather than codes is the whole
 * difference between this and a duplicate factory.
 *
 * What it will not do is invent the one thing it cannot know. Both target
 * services require a workbook id that exists in no other service, so most rows
 * come back `blocked` with that named. Blocked rows are shown, not hidden: "34
 * of 36 need a Safety workbook id" is the answer to the request, and quietly
 * creating the two that happen to be complete would be worse than saying so.
 */

/**
 * Columns one service can fill from another, because they hold the same thing.
 *
 * Declared pairs only. "Same key-values for similar fields" is a request that
 * sounds general and is not: `company` means the same everywhere, and almost
 * nothing else does. A WBGT monthly workbook is not a subcon manpower workbook,
 * and copying one into the other points a service at the wrong document.
 *
 * The one pair here is a real equivalence rather than a guess about names.
 * WBGT's `manpower_spreadsheet_id` and subcon's `spreadsheet_id` are both "the
 * site's Manpower workbook", and on ZRB — the only project configured in both
 * services — the two ids are byte-identical. It is still shown in the review
 * list with where it came from, because one confirmed case is evidence, not
 * proof, and the operator is the one who knows the site.
 *
 * Adding a pair here needs the same standard: two columns that are documented
 * as the same artefact, not two columns whose names rhyme.
 */
const CARRIED_FROM: Partial<
  Record<ServiceKey, Record<string, { from: ServiceKey; column: string; why: string }>>
> = {
  subcon: {
    spreadsheet_id: {
      from: "wbgt",
      column: "manpower_spreadsheet_id",
      why: "the same site's Manpower workbook, as configured in WBGT",
    },
  },
};

/**
 * Cues that a service is named as a SOURCE to copy from, not a target to
 * create in.
 *
 * "Onboard into subcon, manpower sheet should follow whatever was written in
 * WBGT" names two services and means entirely different things by them.
 * Without this, WBGT reads as a second target: on the live estate that plan
 * proposed nine new WBGT projects, each of which runs DDL to create a readings
 * table. A false positive here is not a stray row, it is schema.
 */
const SOURCE_CUES = /\b(follow(?:s|ing|ed)?|from|according\s+to|same\s+as|copy|copied|mirror(?:s|ing)?|like|matching|as\s+in|based\s+on|per)\b/i;

/** How far back to look for a source cue. One clause, not the whole sentence. */
const SOURCE_WINDOW = 60;

/**
 * The services a sentence asks to create IN, dropping any named only as a
 * source to read from.
 */
export function onboardTargetsIn(prompt: string, hints: ServiceKey[]): ServiceKey[] {
  const text = prompt.toLowerCase();
  return hints.filter((service) => {
    // Where this service is mentioned. The label and the key are both used in
    // practice ("subcon activities", "issue chaser").
    const needle = [SERVICES[service].label.toLowerCase(), service.toLowerCase()]
      .map((word) => text.indexOf(word))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (needle === undefined) return true;
    const window = text.slice(Math.max(0, needle - SOURCE_WINDOW), needle);
    return !SOURCE_CUES.test(window);
  });
}

/** The scope in one phrase, for the review list's heading. */
function describeFilters(scope: OnboardIntent["scope"]): string {
  const say = (filter: SiteFilter): string =>
    filter.kind === "company"
      ? `${filter.company} sites`
      : filter.kind === "in-service"
        ? `sites configured in ${SERVICES[filter.service].label}`
        : filter.kind === "any"
          ? `(${filter.of.map(say).join(" or ")})`
          : `${filter.codes.join(", ")}`;
  const head = scope.include.length ? scope.include.map(say).join(" that are also ") : "Sites";
  const tail = scope.exclude.length ? ` except ${scope.exclude.map(say).join(" or ")}` : "";
  return (head + tail).replace(/^./, (first) => first.toUpperCase());
}

/** The columns a service has a declared equivalence for. */
export function carryColumnsFor(service: ServiceKey): string[] {
  return Object.keys(CARRIED_FROM[service] ?? {});
}

/** The equivalence this estate vouches for, if any, for one target column. */
export function declaredCarrySource(
  service: ServiceKey,
  column: string,
): { from: ServiceKey; column: string } | null {
  const source = CARRIED_FROM[service]?.[column];
  return source ? { from: source.from, column: source.column } : null;
}

/**
 * Find the group a pattern names for one site.
 *
 * `<site>` stands for any of that site's codes, which is the part that has to
 * go through the identity map: the chat is called "TBC x WL Coordination" and
 * the noise row calls the same site "TBCA". Matching on the canonical code
 * alone would miss it.
 *
 * Folded on both sides so case and spacing do not matter, and anchored at the
 * start so "IR2 x WL coordination" cannot be claimed by a site called "R2".
 */
export function resolveGroupPattern(
  pattern: string,
  codes: string[],
  groups: { chatId: string; name: string }[],
): { chatId: string; name: string } | null {
  const placeholder = /<\s*site\s*>|\bsite\b/i;
  const tail = fold(pattern.replace(placeholder, "|").split("|").slice(1).join(" "));
  if (!tail) return null;
  const folded = codes.map(fold).filter(Boolean);
  for (const group of groups) {
    const name = fold(group.name);
    for (const code of folded) {
      if (name === code + tail) return group;
    }
  }
  return null;
}

/** Onboarding words, as against the edit vocabulary the other paths handle. */
const ONBOARD = /\b(onboard(?:ed|ing)?|create|set\s+up|register)\b/i;
const PROJECT_NOUN = /\b(project|projects|site|sites)\b/i;

/** Edit distance, capped — only used to decide whether one word is another. */
function withinEdits(a: string, b: string, budget: number): boolean {
  if (Math.abs(a.length - b.length) > budget) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    if (Math.min(...current) > budget) return false;
    previous = current;
  }
  return previous[b.length] <= budget;
}

/** Words meaning "make new projects", and the nouns that disambiguate `create`. */
const ONBOARD_VERBS = ["onboard", "onboarded", "onboarding", "create", "register", "setup"];
const PROJECT_NOUNS = ["project", "projects", "site", "sites"];

/**
 * Whether a request is asking for projects to be created.
 *
 * Typo-tolerant, because this decides which path runs and therefore whether a
 * model reads the request at all. "onbaord isue chaserr projcts" is plainly an
 * onboarding request, and a literal regex sent it to the single-project path
 * where it died as "Which project?" — the reading never happened. A router
 * that fails on a slip is worse than a slightly loose one, because the loose
 * case ends in a preview and the strict case ends in a refusal.
 *
 * "add" is still excluded on meaning rather than spelling: it is the verb for
 * both "add a project" and "add this group to CFC", and the second is far more
 * common.
 */
export function saysOnboard(prompt: string): boolean {
  const words = prompt.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  // Adjacent pairs joined too, so the two-word "set up" reaches "setup".
  const tokens = [...words, ...words.slice(0, -1).map((word, index) => word + words[index + 1])];
  const near = (targets: string[], budget = 2) =>
    tokens.some((token) =>
      targets.some((target) => token === target || withinEdits(token, target, token.length <= 5 ? 1 : budget)),
    );
  if (!near(ONBOARD_VERBS)) return false;
  // A form of "onboard" is unambiguous; "create" needs a project noun, since
  // "create a new group list" is an edit.
  if (near(["onboard", "onboarded", "onboarding"])) return true;
  return near(PROJECT_NOUNS, 1);
}

/**
 * Words that identify each switch in a sentence, and the polarity words around
 * them.
 *
 * Deterministic on purpose. Three booleans do not need a model, and a model is
 * the wrong tool for them anyway: it would be the one part of this path where
 * something other than code decided what gets written. Keywords are declared
 * rather than derived from labels, because "manpower" appears in both summary
 * names and matching on the label alone sets the wrong one.
 */
const SWITCH_WORDS: Record<string, RegExp> = {
  enable_housekeeping: /\bhousekeeping\b(?!\s+report)/i,
  enable_manpower_summary: /\bmanpower\s*(?:\+|and|&)?\s*(?:machine|machines)?\s*(?:summary|report)\b|\bmachines?\s*(?:summary|report)\b/i,
  enable_activity_summary: /\bactivity\s*(?:\+|and|&)?\s*(?:manpower)?\s*(?:summary|report)\b/i,
};

const NEGATORS = /\b(not|no|never|without|off|disable[ds]?|exclude|omit|skip|dont|don't|excluding)\b/i;
const AFFIRMERS = /\b(with|have|has|enable[ds]?|on|include[ds]?|yes|only|want|set)\b/i;

/**
 * Which switches a sentence asks for, and what it left unsaid.
 *
 * Polarity is read from a window BEFORE the switch's own words, which is where
 * English puts it: "not have housekeeping", "manpower summary enabled",
 * "(not the activity summary)". A window rather than the whole sentence,
 * because one clause's negation must not leak into the next — "no housekeeping
 * but have the manpower report" says two different things.
 *
 * Anything it cannot read confidently is left out and named in `unread`, so the
 * review list can say "this part of your sentence was not applied" instead of
 * quietly defaulting it. Guessing a boolean that starts or silences a daily
 * message to a construction site is not a reasonable thing to do.
 */
export function switchesIn(
  prompt: string,
  columns: string[],
): { values: Record<string, string>; unread: string[] } {
  const values: Record<string, string> = {};
  const unread: string[] = [];

  // Matched longest-first, and a match inside another one is discarded.
  // "activity + manpower summary" satisfies BOTH summary patterns, and reading
  // it as the manpower report as well would switch on a second daily message
  // nobody asked for.
  const matches: { column: string; match: RegExpExecArray }[] = [];
  for (const column of columns) {
    const pattern = SWITCH_WORDS[column];
    if (!pattern) continue;
    const match = pattern.exec(prompt);
    if (match) matches.push({ column, match });
  }
  matches.sort((a, b) => b.match[0].length - a.match[0].length);
  const claimed: { start: number; end: number }[] = [];

  for (const { column, match } of matches) {
    const start = match.index;
    const end = start + match[0].length;
    if (claimed.some((span) => start >= span.start && end <= span.end)) continue;
    claimed.push({ start, end });

    // The clause this switch sits in: back to the previous separator, so a
    // comma or bracket ends the reach of a negation.
    const before = prompt.slice(0, match.index);
    const clauseStart = Math.max(
      before.lastIndexOf(","), before.lastIndexOf("("), before.lastIndexOf(";"),
      before.lastIndexOf(" but "), before.lastIndexOf("."),
    );
    const window = before.slice(clauseStart + 1);
    // And the trailing "… enabled" form — but stopping at the next separator
    // for the same reason the leading window starts at one. Without the cut,
    // "manpower summary enabled (not the activity summary)" reads the NEXT
    // clause's negation as its own and silences the report being asked for.
    const rest = prompt.slice(match.index + match[0].length, match.index + match[0].length + 40);
    const cut = rest.search(/[,;(.]| but /);
    const after = cut === -1 ? rest : rest.slice(0, cut);

    const negated = NEGATORS.test(window) || NEGATORS.test(after);
    const affirmed = AFFIRMERS.test(window) || AFFIRMERS.test(after);
    if (negated) values[column] = "false";
    else if (affirmed) values[column] = "true";
    else unread.push(column);
  }
  return { values, unread };
}

/**
 * What a sentence is asking for, as shapes rather than data.
 *
 * This is the one thing a model is asked for on this path, and the split is the
 * point: the model reads English — which service is the target and which is
 * merely named as a source, whether "on noise meters" scopes or targets — and
 * code turns that reading into rows. Nothing here can name a project, a chat id
 * or a sheet id, so a misread intent produces the wrong SET of rows, visible in
 * the review list, rather than a row full of invented values.
 *
 * Keyword matching did the reading before this, and it is what misread "sites
 * that exist on noise meters" as an instruction to create noise projects.
 */
export type OnboardIntent = {
  /** Services to create rows IN. */
  targets: ServiceKey[];
  /**
   * Which sites, as composable filters rather than three fixed shapes.
   *
   * `include` is AND-ed and `exclude` wins. "All Wohhup sites that are also
   * already in Noise" is an intersection, and it was the first thing anyone
   * asked for — an OR-only list could not express it at all, and the model
   * correctly refused rather than quietly widening the request.
   *
   * A union is still available, explicitly: `{kind:"any", of:[...]}`. An empty
   * `include` means every site.
   *
   * `codes` is safe for the model to supply because a code here only SELECTS —
   * it is matched against sites that already exist, so an invented one matches
   * nothing. The code a row is CREATED with is always the canonical site code,
   * which comes from the identity map and never from the model.
   */
  scope: { include: SiteFilter[]; exclude: SiteFilter[] };
  /** Column → value, for switches the target offers at creation. */
  switches: Record<string, boolean>;
  /**
   * Literal values for any column the target's onboarding flow carries.
   *
   * The general case the switch map could not express: "set the outbound group
   * to X", "timezone Asia/Singapore". An explicit value beats a carried one,
   * because an instruction is more specific than an equivalence.
   */
  values: Record<string, string>;
  /**
   * Values used ONLY where the column is still empty after everything else.
   *
   * "If no applicable WBGT manpower workbook is configured, use X" is this, and
   * it is a different thing from `values`: it must not overwrite the workbook
   * that was carried for the seventeen sites that have one.
   */
  fallbacks: Record<string, string>;
  /**
   * Columns to fill from another service's row for the same site.
   *
   * Any pair the model asks for is honoured, not only the ones this file
   * declares. `declared` says which — an undeclared copy is shown in the
   * review list as unverified rather than refused, because the operator knows
   * the sites and the preview is where a wrong document gets caught. Refusing
   * it outright only meant the request silently did less than it said.
   */
  carry: { column: string; from: ServiceKey; fromColumn: string; declared: boolean }[];
  /** Groups looked up by name, `<site>` standing for any of the site's codes. */
  groupPatterns: { column: string; pattern: string }[];
  /** Anything recognised in the sentence that this shape cannot express. */
  notes: string[];
};

export type SiteFilter =
  | { kind: "company"; company: string }
  | { kind: "in-service"; service: ServiceKey }
  | { kind: "codes"; codes: string[] }
  /** Matches when ANY of its members match. Nests, so filters compose freely. */
  | { kind: "any"; of: SiteFilter[] };

/** Read the model's answer, keeping only what it is entitled to decide. */
export function parseOnboardIntent(
  parsed: Record<string, unknown> | null,
  allowed: {
    services: ServiceKey[];
    switchColumns: string[];
    /** Every column any target is created with, for `values` / `fallbacks`. */
    valueColumns: string[];
    /** The equivalences this estate vouches for, keyed by target column. */
    declaredCarry: Record<string, { from: ServiceKey; column: string }>;
  },
): OnboardIntent | { question: string } | null {
  if (!parsed) return null;
  if (typeof parsed.question === "string" && parsed.question.trim()) {
    return { question: parsed.question.trim() };
  }

  const notes: string[] = Array.isArray(parsed.notes)
    ? parsed.notes.map((note) => String(note)).filter(Boolean)
    : [];

  const asService = (value: unknown): ServiceKey | null => {
    const key = String(value ?? "").trim() as ServiceKey;
    return allowed.services.includes(key) ? key : null;
  };

  const targets = (Array.isArray(parsed.targets) ? parsed.targets : [])
    .map(asService)
    .filter((key): key is ServiceKey => Boolean(key));
  if (!targets.length) return null;

  const readFilters = (raw: unknown, label: string): SiteFilter[] | null => {
    const out: SiteFilter[] = [];
    for (const entry of (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]) {
      const kind = String(entry?.kind ?? "").trim();
      if (kind === "company" && String(entry?.company ?? "").trim()) {
        out.push({ kind: "company", company: String(entry.company).trim() });
      } else if (kind === "in-service") {
        const service = asService(entry?.service);
        // An unrecognised service is refused rather than dropped: dropping an
        // INCLUDE silently widens the plan to the whole estate.
        if (!service) return null;
        out.push({ kind: "in-service", service });
      } else if (kind === "codes" && Array.isArray(entry?.codes)) {
        const codes = entry.codes.map((code) => String(code).trim()).filter(Boolean);
        if (codes.length) out.push({ kind: "codes", codes });
      } else if (kind === "any") {
        const of = readFilters(entry?.of, label);
        if (of === null) return null;
        if (of.length) out.push({ kind: "any", of });
      } else {
        notes.push(`could not read one ${label} filter, so it was ignored`);
      }
    }
    return out;
  };

  const rawScope = (parsed.scope ?? {}) as Record<string, unknown>;
  const include = readFilters(rawScope.include, "include");
  const exclude = readFilters(rawScope.exclude, "exclude");
  if (!include || !exclude) return null;
  const scope = { include, exclude };

  const values: Record<string, string> = {};
  const fallbacks: Record<string, string> = {};
  for (const [field, target] of [
    ["values", values],
    ["fallbacks", fallbacks],
  ] as const) {
    for (const [column, value] of Object.entries((parsed[field] ?? {}) as Record<string, unknown>)) {
      if (!allowed.valueColumns.includes(column)) {
        notes.push(`"${column}" is not a field this service is created with, so it was not set`);
        continue;
      }
      if (value === null || value === undefined || typeof value === "object") {
        notes.push(`"${column}" was not given as a plain value, so it was left alone`);
        continue;
      }
      target[column] = String(value);
    }
  }

  const switches: Record<string, boolean> = {};
  for (const [column, value] of Object.entries((parsed.switches ?? {}) as Record<string, unknown>)) {
    if (!allowed.switchColumns.includes(column)) {
      notes.push(`"${column}" is not a switch offered at creation, so it was not set`);
      continue;
    }
    if (typeof value === "boolean") switches[column] = value;
    else notes.push(`"${column}" was not given as true or false, so it was left at its default`);
  }

  const carry: OnboardIntent["carry"] = [];
  for (const entry of (Array.isArray(parsed.carry) ? parsed.carry : []) as Record<string, unknown>[]) {
    const column = String(entry?.column ?? "").trim();
    const from = asService(entry?.from);
    if (!from || !column) {
      notes.push(`could not read a copy instruction for "${column || "?"}", so nothing was copied`);
      continue;
    }
    // Any pair is honoured. `declared` marks the ones this file vouches for;
    // the rest are shown as unverified in the review list, which is where a
    // wrong document actually gets caught.
    const declaredSource = allowed.declaredCarry[column];
    const fromColumn = String(entry?.fromColumn ?? "").trim() || declaredSource?.column || column;
    carry.push({
      column,
      from,
      fromColumn,
      declared: declaredSource?.from === from && declaredSource?.column === fromColumn,
    });
  }

  const groupPatterns: OnboardIntent["groupPatterns"] = [];
  const rawPatterns = Array.isArray(parsed.groupPatterns)
    ? parsed.groupPatterns
    : parsed.groupPattern
      ? [parsed.groupPattern]
      : [];
  for (const entry of rawPatterns as Record<string, unknown>[]) {
    const pattern = String(entry?.pattern ?? "").trim();
    if (!pattern) continue;
    groupPatterns.push({
      column: String(entry?.column ?? "safety_group_ids").trim(),
      pattern,
    });
  }

  return { targets, scope, switches, values, fallbacks, carry, groupPatterns, notes };
}

export type OnboardRow = {
  /** The canonical site code from the identity map — what gets created. */
  projectCode: string;
  /** Values the plan can supply without asking anyone. */
  values: Record<string, string>;
  /** What this site is already called elsewhere, so the reviewer can tell. */
  knownAs: { service: ServiceKey; projectCode: string }[];
  /**
   * Why this row cannot be created as it stands, in `validateDraft`'s own
   * words — the same validator the onboarding dialog and the insert route use,
   * so the reviewer sees exactly what a save would have said.
   */
  problems: string[];
  /**
   * Values taken from another service's row for the same site, and why. Shown
   * in the review list: a derived workbook id is the one value an operator
   * most needs to check before it is written.
   */
  derived: { column: string; from: string; value: string; why: string }[];
};

export type ServicePlan = {
  service: ServiceKey;
  label: string;
  /** Rows that can be created as they stand. */
  ready: OnboardRow[];
  /** Rows short a required field. Listed, never silently dropped. */
  blocked: OnboardRow[];
  /** Sites already present under some code, and which one. */
  alreadyThere: { projectCode: string; existingAs: string }[];
};

export type OnboardPlan =
  | {
      kind: "plan";
      company: string | null;
      summary: string;
      services: ServicePlan[];
      /**
       * Parts of the request that were recognised but not applied. Shown, never
       * swallowed: silently defaulting a switch that starts or silences a daily
       * message to a site is not a reasonable thing to do quietly.
       */
      unread: string[];
    }
  | { kind: "question"; question: string };

/** The fields a plan can fill without a human: identity plus env-backed defaults. */
function draftFor(
  definition: OnboardDefinition,
  cluster: Cluster,
  company: string | null,
  env: Record<string, string | undefined>,
  existingFor: (service: ServiceKey) => ProjectConfigRow[],
  switches: Record<string, string>,
  asked: { values: Record<string, string>; fallbacks: Record<string, string> },
  requested: OnboardIntent["carry"],
): { draft: OnboardDraft; derived: OnboardRow["derived"] } {
  const draft: OnboardDraft = {
    ...prefillDefaults(definition, env),
    project_code: cluster.canonical,
    // Read from the sentence, so "no housekeeping, manpower report on" is set
    // at creation rather than left for a second pass over every new row.
    ...switches,
  };
  // Carried because it is the one field that means the same thing in every
  // service.
  if (company && definition.fields.some((field) => field.column === "company")) {
    draft.company = company;
  }

  // An explicit instruction beats a carried equivalence, so these go on before
  // the carry runs and the carry then skips a column that already has a value.
  const columns = new Set(definition.fields.map((field) => field.column));
  for (const [column, value] of Object.entries(asked.values)) {
    if (columns.has(column)) draft[column] = value;
  }

  // The declared equivalences, plus whatever the sentence asked for. A request
  // for a pair this file does not vouch for is performed and marked, not
  // refused — the operator sees the value and its source in the review list.
  const sources = new Map<string, { from: ServiceKey; column: string; why: string; declared: boolean }>();
  for (const [column, source] of Object.entries(CARRIED_FROM[definition.service] ?? {})) {
    sources.set(column, { ...source, declared: true });
  }
  for (const asked of requested) {
    sources.set(asked.column, {
      from: asked.from,
      column: asked.fromColumn,
      why: asked.declared
        ? (CARRIED_FROM[definition.service]?.[asked.column]?.why ?? "asked for in your sentence")
        : `asked for in your sentence — ${SERVICES[asked.from].label}.${asked.fromColumn} is not a declared equivalent of this column, so check it`,
      declared: asked.declared,
    });
  }

  const derived: OnboardRow["derived"] = [];
  for (const [column, source] of sources) {
    if (!columns.has(column)) continue;
    if (String(draft[column] ?? "").trim()) continue;
    // The identity map is what makes this possible: the source row is found by
    // SITE, so a value written against `MBS` in WBGT reaches a subcon row being
    // created as `IR2`.
    const member = cluster.members.find((entry) => entry.service === source.from);
    if (!member) continue;
    const row = existingFor(source.from).find(
      (candidate) => String(candidate.project_code ?? "").trim() === member.projectCode,
    );
    const value = String((row as Record<string, unknown> | undefined)?.[source.column] ?? "").trim();
    if (!value) continue;
    draft[column] = value;
    derived.push({
      column,
      from: `${SERVICES[source.from].label}: ${member.projectCode}.${source.column}`,
      value,
      why: source.why,
    });
  }

  // Last, and only into a gap: "if no WBGT workbook is configured, use X" must
  // not overwrite the workbook carried for the sites that have one.
  for (const [column, value] of Object.entries(asked.fallbacks)) {
    if (!columns.has(column) || String(draft[column] ?? "").trim()) continue;
    draft[column] = value;
    derived.push({
      column,
      from: "your sentence",
      value,
      why: "fallback, because nothing else supplied it",
    });
  }
  return { draft, derived };
}

/**
 * The deterministic reading, used when no model is configured or reachable.
 *
 * Kept rather than deleted: it is worse at English than the model — it is what
 * misread "on noise meters" — but it needs no key and no network, and a
 * dashboard that cannot propose anything because a provider is down is worse
 * than one that proposes the obvious cases.
 */
export function intentFromPrompt(prompt: string): OnboardIntent | { question: string } {
  const hinted = serviceHintsIn(prompt);
  const targets = onboardTargetsIn(prompt, hinted);
  if (hinted.length && !targets.length) {
    return {
      question: `Every service named — ${hinted
        .map((key) => SERVICES[key].label)
        .join(", ")} — reads as somewhere to copy FROM, not somewhere to create in. Name the target service plainly.`,
    };
  }
  const company = companyIn(prompt);
  return {
    targets,
    scope: { include: company ? [{ kind: "company", company }] : [], exclude: [] },
    // Filled per target later, once the target's own switch columns are known.
    switches: {},
    values: {},
    fallbacks: {},
    carry: [],
    groupPatterns: [],
    notes: [],
  };
}

export function planOnboarding({
  prompt,
  intent: given,
  clusters,
  existingFor,
  env,
  groupNames,
}: {
  prompt: string;
  /** The model's reading. Omitted falls back to `intentFromPrompt`. */
  intent?: OnboardIntent;
  clusters: Cluster[];
  existingFor: (service: ServiceKey) => ProjectConfigRow[];
  env: Record<string, string | undefined>;
  /** Every known chat, for resolving a `<site> x …` group pattern by name. */
  groupNames?: { chatId: string; name: string }[];
}): OnboardPlan {
  const chats = groupNames ?? [];
  const read = given ?? intentFromPrompt(prompt);
  if ("question" in read) return { kind: "question", question: read.question };
  const targets = read.targets;
  if (!targets.length) {
    return {
      kind: "question",
      question:
        "Which service should these be onboarded into? Name it — WBGT, noise, haze, lightning, Ailytics, subcon or issue chaser.",
    };
  }

  const scope = read.scope;
  const company =
    scope.include.find((filter): filter is { kind: "company"; company: string } => filter.kind === "company")
      ?.company ?? null;

  const matches = (filter: SiteFilter, cluster: Cluster): boolean => {
    if (filter.kind === "company") return clusterCompany(cluster, existingFor) === filter.company;
    // Membership, not company: "every site that exists on noise meters".
    if (filter.kind === "in-service") {
      return cluster.members.some((member) => member.service === filter.service);
    }
    if (filter.kind === "any") return filter.of.some((inner) => matches(inner, cluster));
    // A code SELECTS a site by any of its spellings. An invented one matches
    // nothing, which is why the model is allowed to supply these.
    const wanted = new Set(filter.codes.map(fold));
    return cluster.codes.some((code) => wanted.has(fold(code)));
  };

  /**
   * Includes are AND-ed, excludes win. An empty include list is every site, so
   * a sentence that names no scope still means something rather than nothing.
   */
  const inScope = (cluster: Cluster) => {
    if (scope.exclude.some((filter) => matches(filter, cluster))) return false;
    return scope.include.every((filter) => matches(filter, cluster));
  };
  const services: ServicePlan[] = [];
  /** Parts of the sentence that were understood but could not be acted on. */
  const unreadRequests: string[] = [...read.notes];

  for (const service of targets) {
    const definition = onboardingFor(service);
    if (!definition) {
      return {
        kind: "question",
        question: `${SERVICES[service].label} has no onboarding flow, so projects cannot be created in it from here.`,
      };
    }

    // Sites, not codes. `absentFrom` counts a site as present if ANY of its
    // aliases is in the service, which is what stops a second row being made
    // for a project that is already there under a different spelling.
    const missingSites = absentFrom(clusters, service).filter(inScope);

    // Only the switches this service actually offers at creation. A column the
    // onboarding flow does not carry cannot be set by an insert, so asking for
    // one is reported rather than silently dropped.
    const toggleColumns = definition.fields
      .filter((field) => field.kind === "toggle")
      .map((field) => field.column);
    // The model's reading wins where it gave one; the keyword parser fills the
    // rest, so a fallback run still sets what it can read.
    const switches: Record<string, string> = {};
    for (const [column, value] of Object.entries(read.switches)) {
      if (toggleColumns.includes(column)) switches[column] = value ? "true" : "false";
    }
    if (!Object.keys(switches).length) {
      const { values, unread } = switchesIn(prompt, toggleColumns);
      Object.assign(switches, values);
      for (const column of unread) {
        unreadRequests.push(
          `${SERVICES[service].label}: could not tell whether "${column}" should be on or off`,
        );
      }
    }

    const ready: OnboardRow[] = [];
    const blocked: OnboardRow[] = [];
    for (const cluster of missingSites) {
      const { draft, derived } = draftFor(
        definition,
        cluster,
        company,
        env,
        existingFor,
        switches,
        { values: read.values, fallbacks: read.fallbacks },
        read.carry,
      );

      // "unless you can identify that it's a '<site> x WL coordination' chat".
      // Left empty where there is no match, which is what the request asked
      // for — a wrong group is a report sent to the wrong people.
      for (const wanted of read.groupPatterns) {
        if (!definition.fields.some((field) => field.column === wanted.column)) continue;
        const match = resolveGroupPattern(wanted.pattern, cluster.codes, chats);
        if (!match) continue;
        draft[wanted.column] = match.chatId;
        derived.push({
          column: wanted.column,
          from: `WhatsApp: ${match.name}`,
          value: match.chatId,
          why: `matched "${wanted.pattern}" for this site`,
        });
      }
      const problems = validateDraft(definition, draft, existingFor(service), env);
      const row: OnboardRow = {
        projectCode: cluster.canonical,
        values: draft,
        knownAs: cluster.members,
        problems,
        derived,
      };
      (problems.length ? blocked : ready).push(row);
    }

    const alreadyThere = clusters
      .filter((cluster) => cluster.members.some((member) => member.service === service))
      .filter(inScope)
      .map((cluster) => ({
        projectCode: cluster.canonical,
        existingAs: cluster.members.find((member) => member.service === service)!.projectCode,
      }));

    services.push({ service, label: SERVICES[service].label, ready, blocked, alreadyThere });
  }

  const totalReady = services.reduce((sum, plan) => sum + plan.ready.length, 0);
  const totalBlocked = services.reduce((sum, plan) => sum + plan.blocked.length, 0);
  if (!totalReady && !totalBlocked) {
    return {
      kind: "question",
      question: `Every ${company ?? ""} site is already onboarded in ${services
        .map((plan) => plan.label)
        .join(" and ")}. Nothing to create.`.replace(/\s+/g, " "),
    };
  }

  return {
    kind: "plan",
    unread: unreadRequests,
    company,
    summary:
      `${describeFilters(scope)} missing from ` +
      `${services.map((plan) => plan.label).join(" and ")}: ` +
      `${totalReady} ready to create, ${totalBlocked} short a required field.`,
    services,
  };
}

/**
 * The company a site belongs to, read off whichever existing row carries one.
 *
 * A site is one row per service and `company` is set per row, so they can
 * disagree; the first non-blank wins rather than the request failing over a
 * field nothing reads. Sites with no company anywhere are excluded when a
 * company was asked for, because including them would be a guess.
 */
function clusterCompany(
  cluster: Cluster,
  existingFor: (service: ServiceKey) => ProjectConfigRow[],
): string | null {
  for (const member of cluster.members) {
    const row = existingFor(member.service).find(
      (candidate) => String(candidate.project_code ?? "").trim() === member.projectCode,
    );
    const company = String(row?.company ?? "").trim();
    if (company) return company;
  }
  return null;
}

/**
 * What the model is asked, and the only thing it is asked on this path.
 *
 * It reads English and returns shapes. It never returns a project code, a chat
 * id or a sheet id — those come from the estate, resolved after this. So the
 * worst a misreading can do is select the wrong SET of rows, which the review
 * list then shows before anything is written.
 *
 * Read by a test, so the shape it promises and the shape `parseOnboardIntent`
 * accepts cannot drift apart.
 */
export const ONBOARD_INTENT_PROMPT = [
  "You read a request from an operations engineer asking for projects to be CREATED, and return JSON describing",
  "the actions to take. Deciding which sites and what values is your job.",
  "",
  "Interpret it. Requests arrive with typos, missing words, service names spelled loosely and sentences that do not",
  "parse — read through all of that to what was meant. Never refuse or narrow a request because of how it is",
  "written, and never report a limitation you could work around: you are given the whole estate below, so if a",
  "filter cannot express the set, work the set out yourself and list the codes.",
  "",
  "Nothing you return is written. It becomes a list the operator reads row by row and confirms, so acting on a",
  "reasonable reading beats asking. Ask only when the OUTCOME is genuinely unclear — never about which rows, and",
  "never about spelling.",
  "",
  "Never invent a chat id or a spreadsheet id — there is no field for them. Project codes you may name, but only",
  "ones that appear in the estate below; the row is created under the site's canonical alias regardless.",
  "",
  "Reply with JSON only, no prose:",
  "{",
  '  "targets": ["<service key>", ...],           // services to CREATE rows in',
  '  "scope": {"include":[<filter>], "exclude":[<filter>]},  // include is AND-ed; anything matching exclude is out',
  '      <filter> = {"kind":"company","company":"<name>"}',
  '               | {"kind":"in-service","service":"<key>"}   // sites already configured in that service',
  '               | {"kind":"codes","codes":["<code>",...]}   // named outright, by any spelling they use',
  '               | {"kind":"any","of":[<filter>,...]}        // matches if ANY of these do',
  '      "include" is AND-ed, so ["company Wohhup", "in-service noise"] means Wohhup sites that are ALSO in',
  '      noise. For a union, wrap them in {"kind":"any"}. An empty "include" means every site.',
  '  "switches": {"<column>": true|false},        // only columns listed as switches below',
  '  "values": {"<column>": "<value>"},           // set a column outright, any field the target is created with',
  '  "fallbacks": {"<column>": "<value>"},        // used ONLY where nothing else filled that column',
  '  "carry": [{"column":"<col>","from":"<service key>","fromColumn":"<col on that service>"}],',
  '  "groupPatterns": [{"column":"<column>","pattern":"<site> x WL coordination"}],',
  '  "notes": ["anything asked for that this shape cannot express"]',
  "}",
  'Or, if the request cannot be understood: {"question":"<what you need to know>"}',
  "",
  "Rules that matter:",
  "- A service can be named as a TARGET (create in it) or as a SOURCE (read values from it, or scope by it).",
  '  "onboard subcon projects for every site on noise meters, sheet from WBGT" has ONE target — subcon.',
  "  Noise is the scope; WBGT is a carry source. Putting a source in `targets` creates projects nobody asked for.",
  "- `scope` is how the sites are chosen. If the sentence says which service they already exist in, that is",
  '  `in-service`, NOT `company`. Use `all` only when the sentence really means every site.',
  "- `switches` are only the columns listed below for the target. Anything else goes in `notes`.",
  "- If a switch is mentioned but you cannot tell whether it should be on or off, leave it out and say so in `notes`.",
  "  Guessing one starts or silences a daily message to a construction site.",
  '- `groupPatterns` choose groups BY NAME. Write `<site>` where the project code goes; give one per column.',
  "- Put every part of the scope into `scope`. A sentence that says which sites to SKIP means an `exclude` filter,",
  "  not a note — a note changes nothing, and the plan would silently cover more sites than were asked for.",
  "",
  "Worked example.",
  '  "onboard into subcon every site with noise meters but not already in issue chaser, skip Obayashi,',
  '   workbook from WBGT, housekeeping off, manpower summary only" becomes:',
  '  {"targets":["subcon"],',
  '   "scope":{"include":[{"kind":"in-service","service":"noise"}],',
  '            "exclude":[{"kind":"in-service","service":"issueChaser"},{"kind":"company","company":"Obayashi"}]},',
  '   "switches":{"enable_housekeeping":false,"enable_manpower_summary":true,"enable_activity_summary":false},',
  '   "values":{},"fallbacks":{},',
  '   "carry":[{"column":"spreadsheet_id","from":"wbgt","fromColumn":"manpower_spreadsheet_id"}],',
  '   "groupPatterns":[],"notes":[]}',
  "",
  '  "leave the groups empty unless you can identify a \'SITE x WL coordination\' chat" IS a groupPattern:',
  '  {"column":"safety_group_ids","pattern":"<site> x WL coordination"}. It is not a request to leave them empty —',
  "  empty is only what happens for the sites with no such chat, and code decides which those are, not you.",
  '- `values` sets a column outright; `fallbacks` fills one only where nothing else did. "If no WBGT workbook is',
  '  configured, use X" is a FALLBACK — as a `value` it would overwrite the workbook carried for every site that',
  "  has one. Both are limited to columns the target is created with; anything else goes in `notes`.",
  "- `carry` may name ANY column on ANY service. Some pairs are listed below as known equivalents; those are the",
  "  ones this dashboard vouches for. Asking for a pair that is not listed is allowed and WILL be performed — it",
  "  is shown to the operator as unverified. Prefer a listed pair when one fits, and do not invent a copy the",
  "  sentence did not ask for.",
  "- Read the whole sentence and act on all of it. If something is asked for that none of these fields expresses,",
  "  do what you can with the fields there are and put the remainder in `notes`. Do not narrow the request to fit",
  "  the shape, and do not refuse a reasonable reading because the shape is awkward.",
  "- The project code of a created row is ALWAYS the canonical site alias, resolved from the cross-service",
  '  identity map. "Use the project site alias as the code" is already what happens; it needs no field and is',
  "  not a note.",
  "- Every row is ALWAYS created disabled, whatever the sentence says. You never need to express that, and it does",
  "  not belong in `notes`.",
  "- Put anything you understood but could not express into `notes`. It is shown to the operator under",
  '  "Not applied from your sentence", so it must mean exactly that. An instruction that matches what would',
  "  happen anyway — leaving a column empty that is empty by default — was applied, not skipped, and noting it",
  "  buries the parts that really were dropped.",
].join("\n");

/**
 * Every site, with the code each service uses for it and its company.
 *
 * The point of handing this over: with the estate in front of it, any selection
 * the model can reason about is expressible as `codes`, and no new filter kind
 * is ever needed. "Wohhup sites also already in Noise" was a missing AND;
 * "everything except the three we discussed" would have been a missing
 * something-else. Giving it the data ends that sequence rather than extending
 * it one gate at a time.
 *
 * Codes are safe to receive back because they only SELECT — matched against
 * sites that exist, so an invented one selects nothing, and the code a row is
 * created with is the canonical alias either way.
 */
export function siteTableFor(
  clusters: Cluster[],
  existingFor: (service: ServiceKey) => ProjectConfigRow[],
): string {
  const rows = clusters.map((cluster) => {
    const per: Record<string, string> = {};
    for (const member of cluster.members) per[member.service] = member.projectCode;
    return {
      site: cluster.canonical,
      company: clusterCompany(cluster, existingFor),
      in: per,
      ...(cluster.codes.length > 1 ? { aliases: cluster.codes } : {}),
    };
  });
  return [
    `All ${rows.length} sites in the estate. "in" lists the code each service uses; a service absent from it has`,
    "no row for that site yet. Work out which sites the request means from this, and name them in",
    '`scope.codes` when a filter cannot say it — that is always available and always exact.',
    JSON.stringify(rows),
  ].join("\n");
}

/** The facts the model needs about this estate, rendered for the prompt. */
export function onboardIntentContext(
  services: {
    key: ServiceKey;
    label: string;
    hasOnboarding: boolean;
    switches: { column: string; label: string }[];
    /** Every column the service is created with, so a name is never guessed. */
    fields?: { column: string; label: string; kind: string; required: boolean }[];
  }[],
  companies: readonly string[],
): string {
  const lines = ["Services (key — label):"];
  for (const service of services) {
    lines.push(
      `  ${service.key} — ${service.label}${service.hasOnboarding ? "" : "  (no onboarding flow; cannot be a target)"}`,
    );
  }
  // The exact column names, because without them a name gets guessed: a request
  // to default the safety workbook came back as `safety_spreadsheet_id`, which
  // does not exist — the column is `safety_sheet_id` — so the value was
  // dropped and reported instead of being set.
  lines.push("", "Columns each service is CREATED with. Use these names exactly in `values`/`fallbacks`:");
  for (const service of services.filter((entry) => entry.fields?.length)) {
    lines.push(
      `  ${service.key}: ${service
        .fields!.map((field) => `${field.column} (${field.kind}${field.required ? ", required" : ""})`)
        .join(", ")}`,
    );
  }
  lines.push("", "Switches offered at creation, by service:");
  for (const service of services.filter((entry) => entry.switches.length)) {
    lines.push(`  ${service.key}: ${service.switches.map((s) => `${s.column} (${s.label})`).join(", ")}`);
  }
  lines.push("", "Known equivalents — pairs this dashboard vouches for. Others are allowed but shown as unverified:");
  for (const service of services) {
    const columns = carryColumnsFor(service.key);
    if (!columns.length) continue;
    for (const column of columns) {
      const source = CARRIED_FROM[service.key]![column];
      lines.push(`  ${service.key}.${column} <- ${source.from}.${source.column} (${source.why})`);
    }
  }
  lines.push("", `Companies: ${companies.join(", ")}`);
  return lines.join("\n");
}
