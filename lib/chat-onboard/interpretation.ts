import { companyIn, type RowCondition } from "../chat-scope";
import { serviceHintsIn } from "../chat-intent";
import { SERVICES, type ServiceKey } from "../services";
import type { OnboardIntent, SiteFilter } from "./types";

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
      } else if (kind === "where") {
        const service = asService(entry?.service);
        const column = String(entry?.column ?? "").trim();
        const op = String(entry?.op ?? "is").trim() as RowCondition["op"];
        // Same rule as in-service: a condition that cannot be evaluated must
        // not be dropped from an INCLUDE, because dropping it widens the plan.
        if (!service || !column) return null;
        if (!["is", "is-not", "empty", "not-empty", "contains"].includes(op)) return null;
        out.push({ kind: "where", service, column, op, value: entry?.value });
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

  const addresses: NonNullable<OnboardIntent["addresses"]> = [];
  for (const entry of (Array.isArray(parsed.addresses) ? parsed.addresses : []) as Record<string, unknown>[]) {
    const code = String(entry?.code ?? "").trim();
    const address = String(entry?.address ?? "").trim();
    if (!code || !address) {
      notes.push("an address was given without a project code, so it was not looked up");
      continue;
    }
    addresses.push({ code, address });
  }

  // "the same configuration as TEST". The service defaults to the target,
  // because columns are per-service and a template from elsewhere would mostly
  // not fit; naming one explicitly is still allowed.
  let template: OnboardIntent["template"] = null;
  const rawTemplate = parsed.template as Record<string, unknown> | string | undefined;
  const templateCode = String(
    (typeof rawTemplate === "string" ? rawTemplate : rawTemplate?.projectCode) ?? "",
  ).trim();
  if (templateCode) {
    template = { service: asService((rawTemplate as Record<string, unknown>)?.service) ?? targets[0], projectCode: templateCode };
  }

  return { targets, scope, switches, values, fallbacks, carry, template, addresses, groupPatterns, notes };
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
    template: null,
    addresses: [],
    groupPatterns: [],
    notes: [],
  };
}

