import { companyIn } from "./chat-scope";
import { serviceHintsIn } from "./chat-intent";
import {
  onboardingFor,
  prefillDefaults,
  validateDraft,
  type OnboardDefinition,
  type OnboardDraft,
} from "./onboarding";
import { absentFrom, type Cluster } from "./project-identity";
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

/** Onboarding words, as against the edit vocabulary the other paths handle. */
const ONBOARD = /\b(onboard(?:ed|ing)?|create|set\s+up|register)\b/i;
const PROJECT_NOUN = /\b(project|projects|site|sites)\b/i;

/**
 * Whether a sentence is asking for projects to be created.
 *
 * "add" is deliberately absent. It is the verb for both "add a project" and
 * "add this group to CFC", and the second is far more common — reading it as
 * onboarding would send ordinary edits down this path. "onboard", "create",
 * "set up" and "register" do not carry that ambiguity.
 */
export function saysOnboard(prompt: string): boolean {
  if (!ONBOARD.test(prompt)) return false;
  // `create` alone is not enough: "create a new group list" is an edit.
  if (/\bonboard(?:ed|ing)?\b/i.test(prompt)) return true;
  return PROJECT_NOUN.test(prompt);
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

  const derived: OnboardRow["derived"] = [];
  for (const [column, source] of Object.entries(CARRIED_FROM[definition.service] ?? {})) {
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
  return { draft, derived };
}

export function planOnboarding({
  prompt,
  clusters,
  existingFor,
  env,
}: {
  prompt: string;
  clusters: Cluster[];
  existingFor: (service: ServiceKey) => ProjectConfigRow[];
  env: Record<string, string | undefined>;
}): OnboardPlan {
  const hinted = serviceHintsIn(prompt);
  const targets = onboardTargetsIn(prompt, hinted);
  if (hinted.length && !targets.length) {
    return {
      kind: "question",
      question:
        `Every service named — ${hinted.map((key) => SERVICES[key].label).join(", ")} — reads as somewhere to copy FROM, not somewhere to create in. Name the target service plainly.`,
    };
  }
  if (!targets.length) {
    return {
      kind: "question",
      question:
        "Which service should these be onboarded into? Name it — WBGT, noise, haze, lightning, Ailytics, subcon or issue chaser.",
    };
  }

  const company = companyIn(prompt);
  const services: ServicePlan[] = [];
  /** Parts of the sentence that were understood but could not be acted on. */
  const unreadRequests: string[] = [];

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
    const missingSites = absentFrom(clusters, service).filter(
      (cluster) => !company || clusterCompany(cluster, existingFor) === company,
    );

    // Only the switches this service actually offers at creation. A column the
    // onboarding flow does not carry cannot be set by an insert, so asking for
    // one is reported rather than silently dropped.
    const toggleColumns = definition.fields
      .filter((field) => field.kind === "toggle")
      .map((field) => field.column);
    const { values: switches, unread } = switchesIn(prompt, toggleColumns);
    for (const column of unread) {
      unreadRequests.push(`${SERVICES[service].label}: could not tell whether "${column}" should be on or off`);
    }

    const ready: OnboardRow[] = [];
    const blocked: OnboardRow[] = [];
    for (const cluster of missingSites) {
      const { draft, derived } = draftFor(definition, cluster, company, env, existingFor, switches);
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
      .filter((cluster) => !company || clusterCompany(cluster, existingFor) === company)
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
      `${company ? `${company} sites` : "Sites"} missing from ` +
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
