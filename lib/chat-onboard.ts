import { describeConditions, matchesConditions } from "./chat-scope";
import {
  onboardingFor,
  prefillDefaults,
  validateDraft,
  withSchemaFields,
  type OnboardDefinition,
  type OnboardDraft,
} from "./onboarding";
import type { ServiceFieldSpec } from "./field-spec";
import { absentFrom, fold, newSiteCluster, type Cluster } from "./project-identity";
import { SERVICES, type ProjectConfigRow, type ServiceKey } from "./services";
import type { OnboardIntent, OnboardPlan, OnboardRow, ServicePlan, SiteFilter } from "./chat-onboard/types";
import { intentFromPrompt, switchesIn } from "./chat-onboard/interpretation";

export type { OnboardIntent, OnboardPlan, OnboardRow, ServicePlan, SiteFilter } from "./chat-onboard/types";
export {
  intentFromPrompt,
  onboardTargetsIn,
  parseOnboardIntent,
  saysOnboard,
  switchesIn,
} from "./chat-onboard/interpretation";

/**
 * Turn "onboard every Wohhup project into issue chaser" into a reviewable list
 * of rows to create.
 *
 * Language interpretation may come from a model, but this planning module is
 * deterministic. It accepts the constrained `OnboardIntent` shape exported by
 * `chat-onboard/interpretation`, resolves it against HALO's estate, and returns
 * reviewable rows. It cannot write, invent a chat id, or bypass the ordinary
 * onboarding validator. That boundary matters more here than for edits because
 * a created row is a new project someone otherwise has to find and delete.
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


/** The scope in one phrase, for the review list's heading. */
function describeFilters(scope: OnboardIntent["scope"]): string {
  const say = (filter: SiteFilter): string =>
    filter.kind === "company"
      ? `${filter.company} sites`
      : filter.kind === "in-service"
        ? `sites configured in ${SERVICES[filter.service].label}`
        : filter.kind === "any"
          ? `(${filter.of.map(say).join(" or ")})`
          : filter.kind === "where"
            ? `sites whose ${SERVICES[filter.service].label} ${describeConditions([
                { column: filter.column, op: filter.op, value: filter.value },
              ])}`
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




/** Never carried by a template: this row's own identity and audit stamps. */
const IDENTITY_COLUMNS = new Set(["id", "project_code", "created_at", "updated_at", "enabled"]);

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
  template: { service: ServiceKey; row: ProjectConfigRow } | null,
  /** Values resolved for THIS site — today, an address turned into a point. */
  site: { values: Record<string, string>; why: Record<string, string> },
): { draft: OnboardDraft; derived: OnboardRow["derived"] } {
  const columns = new Set(definition.fields.map((field) => field.column));
  const derived: OnboardRow["derived"] = [];

  /**
   * "The same configuration as X" — every creatable column off that row.
   *
   * Identity and audit stamps fall out for free: `columns` is what the service
   * is CREATED with, and `project_code` is excluded explicitly because the
   * template is a different project. Blanks are skipped so a gap in the
   * template does not blank out an env default that would have filled it.
   */
  const templated: Record<string, string> = {};
  if (template) {
    const code = String(template.row.project_code ?? "");
    // A flag the database only permits on an enabled row. Copying it would
    // make every templated row fail its insert with a bare 23514, so it is
    // dropped here and reported once, at plan level, rather than turning a
    // whole batch into blocked rows nobody can unblock.
    const needsEnabled = new Set(definition.requiresEnabled ?? []);
    for (const [column, raw] of Object.entries(template.row)) {
      if (!columns.has(column) || column === "project_code") continue;
      if (needsEnabled.has(column)) continue;
      const value = String(raw ?? "").trim();
      if (!value) continue;
      templated[column] = value;
      derived.push({
        column,
        from: `${SERVICES[template.service].label}: ${code}.${column}`,
        value,
        why: `copied from ${code}, which you asked this to match`,
      });
    }
  }

  const draft: OnboardDraft = {
    ...prefillDefaults(definition, env),
    ...templated,
    project_code: cluster.canonical,
    // Read from the sentence, so "no housekeeping, manpower report on" is set
    // at creation rather than left for a second pass over every new row. After
    // the template on purpose: an instruction is more specific than "the same
    // as X", and this is the one that decides whether a site gets a message.
    ...switches,
  };
  // Carried because it is the one field that means the same thing in every
  // service.
  if (company && definition.fields.some((field) => field.column === "company")) {
    draft.company = company;
  }

  // An explicit instruction beats a carried equivalence, so these go on before
  // the carry runs and the carry then skips a column that already has a value.
  for (const [column, value] of Object.entries(asked.values)) {
    if (!columns.has(column)) continue;
    draft[column] = value;
    // Listed with the same provenance as a carried value. Now that a proposal
    // can set any column, "where did this come from" is the question the
    // review list exists to answer, and "your sentence" is an answer.
    derived.push({ column, from: "your sentence", value, why: "asked for outright" });
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

  /**
   * Values belonging to this site alone, from a lookup rather than a sentence.
   *
   * After the carry, because a coordinate resolved for THIS site beats one
   * copied from a neighbouring service, and after `asked.values` for the same
   * reason a per-site instruction beats a blanket one.
   */
  for (const [column, value] of Object.entries(site.values)) {
    if (!columns.has(column) || !value) continue;
    draft[column] = value;
    derived.push({ column, from: site.why[column] ?? "looked up", value, why: "resolved for this site" });
  }

  /**
   * The values the service itself derives, as the dialog derives them.
   *
   * haze's `nea_region` is the one that matters: it is required, and it is a
   * pure function of the coordinates the step above just resolved. The dialog
   * has run this on every keystroke since it was written; the plan never did,
   * so a proposal with a perfectly good latitude still came back "NEA region
   * is required".
   *
   * Only into a column nothing else filled — the source repo supports an
   * override, so an instruction always wins — and `requiresManualReview`
   * carries into the note rather than being swallowed, because an inferred
   * region is a guess a human should confirm.
   */
  for (const field of definition.fields) {
    if (!field.autofill || String(draft[field.column] ?? "").trim()) continue;
    const result = field.autofill(draft);
    if (!result?.value) continue;
    draft[field.column] = result.value;
    derived.push({
      column: field.column,
      from: "derived by HALO",
      value: result.value,
      // The source note usually says this already — haze's Sengkang rule ends
      // "Confirm against NEA before enabling." — so only add it when it does
      // not, rather than printing the instruction twice.
      why:
        result.review && !/\bconfirm\b/i.test(result.note)
          ? `${result.note} — confirm before enabling`
          : result.note,
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


export function planOnboarding({
  prompt,
  intent: given,
  clusters,
  existingFor,
  env,
  groupNames,
  specs,
  resolved,
}: {
  prompt: string;
  /** The model's reading. Omitted falls back to `intentFromPrompt`. */
  intent?: OnboardIntent;
  /** The estate as it stands. New sites named in the request are added to it. */
  clusters: Cluster[];
  existingFor: (service: ServiceKey) => ProjectConfigRow[];
  env: Record<string, string | undefined>;
  /** Every known chat, for resolving a `<site> x …` group pattern by name. */
  groupNames?: { chatId: string; name: string }[];
  /**
   * Per-site values resolved before the plan ran — an address geocoded, today.
   *
   * Keyed by folded code so a site named `MBS IR2` in the sentence reaches the
   * cluster filed under `MBS`. Resolution happens in the route because it is a
   * network call and this function is pure and synchronous, which is what lets
   * every rule in it be tested without one.
   */
  resolved?: Record<string, { values: Record<string, string>; why: Record<string, string> }>;
  /**
   * Live column lists, so a plan can fill any column the editor could.
   *
   * Omitted, each service falls back to its curated fields — which is what
   * every plan used before, and still the right answer when introspection is
   * down. It is not a smaller plan, only a plan that can say less.
   */
  specs?: Partial<Record<ServiceKey, ServiceFieldSpec | null>>;
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

  /**
   * Codes in the request that name no site in the estate: new projects.
   *
   * Only from `include`, for clarity rather than for safety: a site invented
   * out of an `exclude` would be excluded by the very filter that named it, so
   * scanning both would change no outcome — there is no test here because
   * there is nothing to observe. `codes` nested inside an `any` do count,
   * because `{any:[A, B]}` is how a union is written and both halves include.
   *
   * These are appended to the estate for the length of this plan and never
   * written back to the identity map — the map is derived from rows that
   * exist, and it becomes true about this site the moment the row is created.
   */
  const known = new Set(clusters.flatMap((cluster) => cluster.codes.map(fold)));
  const namedCodes = new Map<string, string>();
  const collectCodes = (filters: SiteFilter[]): void => {
    for (const filter of filters) {
      if (filter.kind === "codes") for (const code of filter.codes) namedCodes.set(fold(code), code);
      else if (filter.kind === "any") collectCodes(filter.of);
    }
  };
  collectCodes(scope.include);
  const newSites = [...namedCodes]
    .filter(([folded]) => folded && !known.has(folded))
    .map(([, code]) => newSiteCluster(code));
  const estate = newSites.length ? [...clusters, ...newSites] : clusters;
  const isNewSite = new Set(newSites.map((cluster) => fold(cluster.canonical)));

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
    if (filter.kind === "where") {
      // Evaluated against that service's real row for this site, found through
      // the identity map — so a condition written about "the WBGT config"
      // reaches the row WBGT calls MBS while the site is filed under IR2.
      const member = cluster.members.find((entry) => entry.service === filter.service);
      if (!member) return false;
      const row = existingFor(filter.service).find(
        (candidate) => String(candidate.project_code ?? "").trim() === member.projectCode,
      );
      if (!row) return false;
      return matchesConditions(row, [{ column: filter.column, op: filter.op, value: filter.value }]);
    }
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

  /**
   * What a lookup produced for this site, matched by any of its spellings.
   *
   * The address is given against the code the operator wrote; the cluster may
   * be filed under a different one, so this folds both sides rather than
   * comparing them literally.
   */
  const resolvedFor = (cluster: Cluster) => {
    for (const code of cluster.codes) {
      const found = resolved?.[fold(code)];
      if (found) return found;
    }
    return { values: {}, why: {} };
  };

  for (const service of targets) {
    const curated = onboardingFor(service);
    if (!curated) {
      return {
        kind: "question",
        question: `${SERVICES[service].label} has no onboarding flow, so projects cannot be created in it from here.`,
      };
    }
    // Curated fields plus every other column the editor would let you change,
    // so a plan can fill anything a person could fill in the dialog.
    const definition = withSchemaFields(curated, specs?.[service]);

    // Sites, not codes. `absentFrom` counts a site as present if ANY of its
    // aliases is in the service, which is what stops a second row being made
    // for a project that is already there under a different spelling.
    const missingSites = absentFrom(estate, service).filter(inScope);

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

    /**
     * The row every draft here copies from, resolved once.
     *
     * By code against the target service's own rows rather than through the
     * identity map: "the same as TEST" names a project, and TEST is a fixture
     * the map deliberately excludes from clustering.
     */
    let template: { service: ServiceKey; row: ProjectConfigRow } | null = null;
    if (read.template) {
      const from = read.template.service;
      const row = existingFor(from).find(
        (candidate) => fold(String(candidate.project_code ?? "")) === fold(read.template!.projectCode),
      );
      if (row) {
        template = { service: from, row };
        /**
         * What "the same configuration as X" could not reach.
         *
         * A template can only carry columns the service is CREATED with, and
         * for issue-chaser that is nine of twenty-three: TEST2 came out
         * matching TEST everywhere the dialog asks about and differing on six
         * columns nobody was told about, which is the quiet half-truth this
         * removes. `enabled` is left out of the list — rows are always created
         * disabled, and that is a rule rather than a gap.
         */
        const creatable = new Set(definition.fields.map((field) => field.column));
        const needsEnabled = new Set(definition.requiresEnabled ?? []);
        const unreachable = Object.entries(row)
          .filter(([column, value]) => {
            if (IDENTITY_COLUMNS.has(column)) return false;
            // Two different reasons a column cannot come across: it is not a
            // column of this service's table at all, or the database only
            // allows it on an enabled row and new rows are always disabled.
            if (creatable.has(column) && !needsEnabled.has(column)) return false;
            return value !== null && value !== false && value !== "" && value !== 0;
          })
          .map(([column]) => column);
        if (unreachable.length) {
          unreadRequests.push(
            `${SERVICES[service].label}: ${String(row.project_code)} also has ${unreachable.join(", ")} set, ` +
              `and a new row cannot carry them — a new row is disabled, and some of these need it enabled. ` +
              `Set them once the project is on.`,
          );
        }
      } else {
        unreadRequests.push(
          `${SERVICES[service].label}: nothing in ${SERVICES[from].label} is called ` +
            `"${read.template.projectCode}", so no configuration was copied from it`,
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
        template,
        resolvedFor(cluster),
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
        isNew: isNewSite.has(fold(cluster.canonical)),
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
  "Never INVENT a chat id or a spreadsheet id. Relaying one is different and is expected: if the request",
  "contains an id, a sheet URL, a time, a radius, a threshold — anything that is a column below — put it in",
  "`values` and it is written. It appears in the review list with where it came from. If the request does not",
  "say, leave the column out and it takes its database default; a guessed group id sends a site's messages to",
  "strangers, and a guessed sheet id fills someone else's workbook.",
  "",
  "Project codes you DO name. A code that appears in the estate below selects that site, under any of its",
  "spellings, and the row is created under its canonical alias. A code that appears nowhere is a site nobody has",
  "configured yet: put it in `scope.include` as a `codes` filter and it is proposed as a NEW project, marked as",
  "new in the review list. That is how the first service for a new site gets created — do not ask which existing",
  "site was meant, and do not refuse because the code is unfamiliar. Use the code the operator wrote.",
  "",
  "Reply with JSON only, no prose:",
  "{",
  '  "targets": ["<service key>", ...],           // services to CREATE rows in',
  '  "scope": {"include":[<filter>], "exclude":[<filter>]},  // include is AND-ed; anything matching exclude is out',
  '      <filter> = {"kind":"company","company":"<name>"}',
  '               | {"kind":"in-service","service":"<key>"}   // sites already configured in that service',
  '               | {"kind":"codes","codes":["<code>",...]}   // named outright, by any spelling they use',
  '               | {"kind":"where","service":"<key>","column":"<column>","op":"is"|"is-not"|"empty"|"not-empty"|"contains","value":<value>}',
  '                 // a condition on that site\'s row in that service — "whose noise config is disabled",',
  '                 // "with no delivery group in WBGT". Evaluated against the real row.',
  '               | {"kind":"any","of":[<filter>,...]}        // matches if ANY of these do',
  '      "include" is AND-ed, so ["company Wohhup", "in-service noise"] means Wohhup sites that are ALSO in',
  '      noise. For a union, wrap them in {"kind":"any"}. An empty "include" means every site.',
  '  "switches": {"<column>": true|false},        // only columns listed as switches below',
  '  "values": {"<column>": "<value>"},           // set a column outright — ANY column of the target, listed below',
  '  "fallbacks": {"<column>": "<value>"},        // used ONLY where nothing else filled that column',
  '  "carry": [{"column":"<col>","from":"<service key>","fromColumn":"<col on that service>"}],',
  '  "template": {"service":"<service key>","projectCode":"<existing code>"},  // copy EVERY column off that row',
  '  "addresses": [{"code":"<project code>","address":"<street address or postal code>"}],  // looked up for you',
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
  '- `template` is "the same configuration as X" / "a copy of X" / "like X". It copies every creatable column',
  "  off that one row; `values` and `switches` then override individual columns. `carry` is the different thing:",
  "  ONE column, from the SAME site's row in ANOTHER service. Use `template` when the sentence names a different",
  "  project to imitate, `carry` when it says where a particular value lives.",
  "- `addresses` is how a site gets its location. NEVER put a latitude or a longitude in `values` — you have no",
  "  way to know them and a wrong one is a site on the wrong island. Put the address the request gives you in",
  "  `addresses` and it is looked up through OneMap; the coordinates, and haze's NEA region derived from them,",
  "  are filled in and shown to the operator with the address they were found at. One entry per site, using the",
  "  project code the row will be created under. An address given for a site is used for EVERY target service",
  "  that has those columns, so a request naming two services and one address needs one entry, not two.",
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
  '  "add a new project TEST2 with the same configuration as TEST in issue chaser, it is a totally new project"',
  "  becomes:",
  '  {"targets":["issueChaser"],',
  '   "scope":{"include":[{"kind":"codes","codes":["TEST2"]}],"exclude":[]},',
  '   "template":{"service":"issueChaser","projectCode":"TEST"},',
  '   "switches":{},"values":{},"fallbacks":{},"carry":[],"groupPatterns":[],"notes":[]}',
  "  TEST2 is in no service, and that is the whole point of the request — it is a new site, not a question.",
  "",
  '  "I need a project code SOILBUILD for lightning and haze. 8 Seletar West Rd 1, Singapore 798990" becomes:',
  '  {"targets":["lightning","haze"],',
  '   "scope":{"include":[{"kind":"codes","codes":["SOILBUILD"]}],"exclude":[]},',
  '   "addresses":[{"code":"SOILBUILD","address":"8 Seletar West Rd 1, Singapore 798990"}],',
  '   "switches":{},"values":{},"fallbacks":{},"carry":[],"groupPatterns":[],"notes":[]}',
  "  One address entry, not two: it is the same site in both services. Latitude, longitude and the NEA region",
  "  are NOT yours to fill — the lookup does them. Lightning's red and amber radii are not yours either and have",
  "  no default: they are client-approved numbers, so the row is reported as short of them unless the request",
  "  actually says what they are. That is a correct answer, not a failure.",
  "",
  '  "leave the groups empty unless you can identify a \'SITE x WL coordination\' chat" IS a groupPattern:',
  '  {"column":"safety_group_ids","pattern":"<site> x WL coordination"}. It is not a request to leave them empty —',
  "  empty is only what happens for the sites with no such chat, and code decides which those are, not you.",
  '- `values` sets a column outright; `fallbacks` fills one only where nothing else did. "If no WBGT workbook is',
  '  configured, use X" is a FALLBACK — as a `value` it would overwrite the workbook carried for every site that',
  "  has one. Both may name ANY column of the target — the full list is below, and it is the whole config",
  "  table. `notes` is for what no column can express, which is now rare; reaching for it when a column exists",
  "  drops something the operator asked for.",
  "- `carry` may name ANY column on ANY service. Some pairs are listed below as known equivalents; those are the",
  "  ones this dashboard vouches for. Asking for a pair that is not listed is allowed and WILL be performed — it",
  "  is shown to the operator as unverified. Prefer a listed pair when one fits, and do not invent a copy the",
  "  sentence did not ask for.",
  "- Read the whole sentence and act on all of it. If something is asked for that none of these fields expresses,",
  "  do what you can with the fields there are and put the remainder in `notes`. Do not narrow the request to fit",
  "  the shape, and do not refuse a reasonable reading because the shape is awkward.",
  "- The project code of a created row is the canonical alias of whichever site the code selected, and for a",
  '  code that selected nothing it is the code itself, upper-cased. "Use the project site alias as the code" is',
  "  already what happens; it needs no field and is not a note.",
  "- `enabled` is the one column you cannot set, and asking for it is not a note either: every row is ALWAYS",
  "  created disabled, whatever the sentence says, and turning it on is a separate act on a row that exists.",
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
    "A code the request names that is NOT in this list is not an error and not a question: it is a site nobody",
    "has configured yet. Name it in `scope.codes` exactly as written and it is proposed as a new project.",
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
    /**
     * Every column of the service's config table, so a name is never guessed
     * and nothing the operator asked for has to be dropped into `notes` for
     * want of somewhere to put it.
     */
    fields?: { column: string; label: string; kind: string; required: boolean; options?: string[] | null }[];
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
  lines.push(
    "",
    "Every column a new row can carry, by service. This is the whole config table, not a shortlist — anything",
    "the operator asks for that is a column here goes in `values` (or `switches`, for a boolean), never in",
    "`notes`. Use these names exactly. A column left out simply takes its database default.",
  );
  for (const service of services.filter((entry) => entry.fields?.length)) {
    lines.push(
      `  ${service.key}: ${service
        .fields!.map((field) => {
          const notes = [field.kind];
          if (field.required) notes.push("required");
          // The allowed values, because a select is the one kind where a
          // plausible-looking guess is rejected by Postgres rather than by
          // anything the operator can see.
          if (field.options?.length) notes.push(`one of ${field.options.join("|")}`);
          return `${field.column} (${notes.join(", ")})`;
        })
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
