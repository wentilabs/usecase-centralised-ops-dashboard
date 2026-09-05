import { COMPANIES } from "./field-spec";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "./services";
import { groupColumnsFor, splitList } from "./card-summary";
import { mentionsCode, serviceHintsIn, type ChatTarget } from "./chat-intent";

/**
 * Who a chat request is about, when it is about more than one project.
 *
 * This is the multi-project half of `chat-intent.ts`, and it keeps that file's
 * central decision: **the set of projects a sentence will change is worked out
 * in code, never by the model.** One project resolved wrongly is a wrong site
 * getting a message; thirty resolved wrongly is thirty. The model is still left
 * with the job only it can do — mapping an outcome onto columns and values.
 *
 * So everything here parses against closed sets HALO already holds: the seven
 * service keys, the three company names, and the project codes themselves.
 * Nothing in this file asks a model anything.
 */

/**
 * Words that mean "not just the one project I named".
 *
 * The quantifier and the noun are allowed a few words apart, because the natural
 * phrasings put the narrowing term in between: "all **noise** projects", "all
 * **Wohhup** projects", "every **enabled** site". Requiring them adjacent
 * refused both of the phrasings this feature was asked for.
 */
const ALL_PROJECTS =
  /\b(?:all|every|each)\s+(?:[\w-]+\s+){0,3}(?:project|site)s?\b|\bestate[-\s]?wide\b|\bacross\s+the\s+estate\b|\bacross\s+all\b/i;

/**
 * How a company can be written, beyond its canonical spelling.
 *
 * `Wohhup` is written "Woh Hup" as often as not, and PentaOcean is two words on
 * the client's own letterhead. Matching only the stored spelling would refuse a
 * request phrased the way the business phrases it.
 */
const COMPANY_ALIASES: Record<string, string> = {
  wohhup: "Wohhup",
  "woh hup": "Wohhup",
  wh: "Wohhup",
  obayashi: "Obayashi",
  pentaocean: "PentaOcean",
  "penta ocean": "PentaOcean",
  penta: "PentaOcean",
};

/** The company a sentence names, or null. Longest alias first, so "penta ocean" beats "penta". */
export function companyIn(prompt: string): string | null {
  const text = ` ${prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const aliases = Object.keys(COMPANY_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (text.includes(` ${alias} `)) return COMPANY_ALIASES[alias];
  }
  return null;
}

export function saysAllProjects(prompt: string): boolean {
  return ALL_PROJECTS.test(prompt);
}

export type Scope =
  /** Explicit codes. One of these is the original single-project path. */
  | { kind: "projects"; targets: ChatTarget[] }
  | { kind: "company"; company: string; services: ServiceKey[]; targets: ChatTarget[] }
  | { kind: "service"; services: ServiceKey[]; targets: ChatTarget[] }
  | { kind: "estate"; targets: ChatTarget[] }
  /** Nothing to act on, or too vague to act on safely. `why` is shown verbatim. */
  | { kind: "none"; hinted: ServiceKey[]; why?: string };

function targetsFor(
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  idColumnFor: (service: ServiceKey) => string,
  keep: (service: ServiceKey, row: ProjectConfigRow) => boolean,
): ChatTarget[] {
  const out: ChatTarget[] = [];
  for (const service of SERVICE_KEYS) {
    for (const row of rows[service] ?? []) {
      const projectCode = String(row.project_code ?? "").trim();
      if (!projectCode || !keep(service, row)) continue;
      out.push({ service, projectCode, rowId: String(row[idColumnFor(service)] ?? projectCode) });
    }
  }
  return out;
}

/**
 * Which projects a sentence could be about.
 *
 * This is a CANDIDATE SET, not a verdict. It decides what the model is shown;
 * the model decides what the request actually means, and says so by returning a
 * scope of its own, which `targetsForOverride` resolves back to rows here. The
 * safety line is that a model never names a row id — not that a keyword gets to
 * settle what the sentence meant.
 *
 * It used to be a precedence chain, and every rule in it was a way of showing
 * the model LESS than the sentence referred to:
 *
 * - "Explicit codes win" meant a code mentioned anywhere replaced everything
 *   else in the sentence. So "mute Sundays for all Wohhup WBGT projects except
 *   MBS and IR2" resolved to MBS — the exclusion selected the row it excluded,
 *   and since IR2 is not a WBGT project that left exactly one, which then read
 *   as a single-project request and came back asking which project was meant.
 * - "A service with no 'all' is not a scope" meant "noise projects should mute
 *   Sundays" was answered with a request for the word "all".
 *
 * Both are now unions: everything the sentence points at is offered, and what
 * to do with each part is the model's call. Showing a row is not touching it —
 * every row still has to survive the model's scope and then a human pressing
 * Apply.
 */
export function resolveScope(
  prompt: string,
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  idColumnFor: (service: ServiceKey) => string,
): Scope {
  const codes = targetsFor(rows, idColumnFor, (_, row) =>
    mentionsCode(prompt, String(row.project_code ?? "")),
  );
  const hints = serviceHintsIn(prompt);
  const company = companyIn(prompt);
  const all = saysAllProjects(prompt);

  /**
   * A company or "all" QUANTIFIES — it says how many. A service name only
   * QUALIFIES — it says which of them.
   *
   * So a bare service hint opens a scope when nothing else narrows the sentence
   * ("noise projects should mute Sundays" — which used to be refused until the
   * word "all" was added), but alongside a named code it is read as telling us
   * which CFC, not as asking for every WBGT project. That keeps an ordinary
   * one-project sentence cheap without deciding anything: the model still sees
   * the rows it names and can widen the scope itself if the sentence meant more.
   */
  const services = hints.length ? hints : [...SERVICE_KEYS];
  const broad: ChatTarget[] = company
    ? targetsFor(
        rows,
        idColumnFor,
        (service, row) => services.includes(service) && String(row.company ?? "").trim() === company,
      )
    : all || (hints.length && !codes.length)
      ? targetsFor(rows, idColumnFor, (service) => services.includes(service))
      : [];

  // The named half. Kept even when a service is named and the code lives
  // elsewhere: "IR2" being absent from WBGT is something the model should be
  // able to say, and it can only say it if the row is in front of it.
  const merged = [...broad];
  const seen = new Set(merged.map((entry) => `${entry.service}:${entry.rowId}`));
  for (const target of codes) {
    const key = `${target.service}:${target.rowId}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(target);
    }
  }

  if (!merged.length) {
    if (company) {
      return { kind: "none", hinted: hints, why: `No ${company} projects${hints.length ? " on that service" : ""}.` };
    }
    if (hints.length) return { kind: "none", hinted: hints, why: "That service has no projects." };
    return { kind: "none", hinted: [] };
  }

  // `kind` now only shapes the sentence shown back to the operator. Nothing
  // routes on it, so a candidate set that is broader than the request is
  // described honestly and then narrowed by the model rather than acted on.
  if (company) return { kind: "company", company, services, targets: merged };
  if (!broad.length) return { kind: "projects", targets: merged };
  if (hints.length) return { kind: "service", services: hints, targets: merged };
  return { kind: "estate", targets: merged };
}

/* ------------------------------------------------------------------ *
 * Fuzzy matching a delivery group by name
 * ------------------------------------------------------------------ */

/**
 * Short forms that string distance cannot derive.
 *
 * "WL" is short for Wentilabs, which no edit distance or token overlap will ever
 * tell you — W and L are the initials of a two-word name written as one word.
 * The estate's own groups are named both ways ("AST x WL Coordination" beside
 * "Wentilabs - WH trial platform"), so a request phrased with either has to
 * reach both. This table is the domain knowledge; everything else in the matcher
 * is mechanical.
 */
const NAME_SYNONYMS: [string, string[]][] = [
  // Not "wenti" on its own: it matched "[Wen] Meeting Notes", "Wenti CL Prod"
  // and every unrelated internal group, because a company's first word is not
  // the company. The full name is what identifies it, and the flattened-name
  // check below is what lets it match the two-word spelling "Wenti Labs".
  ["wl", ["wentilabs"]],
  ["wh", ["wohhup"]],
];

/** Words that carry no identity, so their absence must not sink a match. */
const STOPWORDS = new Set(["x", "the", "and", "for", "of", "group", "groups", "chat", "chats", "all"]);

function tokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

/** Every way a token may be written, itself included. */
function expand(token: string): string[] {
  const out = [token];
  for (const [short, longs] of NAME_SYNONYMS) {
    if (token === short) out.push(...longs.map((l) => l.replace(/\s+/g, "")));
    if (longs.some((l) => l.replace(/\s+/g, "") === token)) out.push(short);
  }
  return out;
}

export type GroupMatch = {
  chatId: string;
  name: string;
  /** 0–1. 1 is an exact phrase hit; the threshold is applied by the caller. */
  score: number;
};

/**
 * Delivery groups whose NAME matches a phrase.
 *
 * Matched on the alias, not the chat id, because "the X WL coordination groups"
 * is how people refer to them and `120363428331338312@g.us` is not. An id with
 * no stored alias can still be matched by writing the id itself.
 *
 * Deliberately generous: this feeds a review list the operator ticks through, so
 * a near-miss shown and rejected costs a glance, while a miss not shown means a
 * group quietly left in place on thirty projects. Precision is the reviewer's
 * job; recall is this function's.
 */
export function matchGroupNames(
  phrase: string,
  names: Record<string, string>,
  { minScore = 1 }: { minScore?: number } = {},
): GroupMatch[] {
  const wanted = tokens(phrase);
  if (!wanted.length) return [];

  const out: GroupMatch[] = [];
  for (const [chatId, rawName] of Object.entries(names)) {
    const name = rawName || chatId;
    const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const have = tokens(name);

    // An exact phrase hit, punctuation ignored — the strongest signal there is.
    const phraseFlat = phrase.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (phraseFlat && flat.includes(phraseFlat)) {
      out.push({ chatId, name, score: 1 });
      continue;
    }

    // Otherwise every identity token must appear, allowing a synonym, an
    // inflection or a longer spelling. "All tokens" rather than "most" is the
    // difference between fuzzy and useless: at half, "X WL coordinations"
    // matched 92 unrelated groups — "AE - Site Coordination All Vendors" on the
    // word coordination alone. Fuzzy has to mean tolerant of how a name is
    // WRITTEN, never tolerant of words that are missing from it.
    let hit = 0;
    for (const token of wanted) {
      const forms = expand(token);
      const byToken = have.some((candidate) =>
        forms.some(
          (form) =>
            candidate === form ||
            // A prefix either way, but only from three characters: at two, "wl"
            // matched the "[Wen]" in a group name and every w-word after it.
            (form.length >= 3 && candidate.startsWith(form)) ||
            (candidate.length >= 3 && form.startsWith(candidate)),
        ),
      );
      // A form may also span two tokens of the name — "WL" means Wentilabs, and
      // the estate writes that as both "Wentilabs" and "Wenti Labs", which
      // tokenises to two words no single token can match.
      const bySpan = forms.some((form) => form.length >= 4 && flat.includes(form));
      if (byToken || bySpan) hit += 1;
    }
    const score = hit / wanted.length;
    if (score >= minScore) out.push({ chatId, name, score });
  }

  // Strongest first, then by name so the list is stable between runs.
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ *
 * Turning a scope + operation into per-row changes
 * ------------------------------------------------------------------ */

export type RowEdit = {
  service: ServiceKey;
  projectCode: string;
  rowId: string;
  changes: Record<string, unknown>;
  /** Human note for the review list, e.g. which groups came out. */
  detail?: string;
};

/**
 * Remove a set of chat ids from every group-holding column of every row.
 *
 * The columns are taken from `GROUP_COLUMNS`, which is the same registry the
 * cards render delivery chips from, so a service's group columns cannot be
 * listed in one place and missed in the other. `single` columns are included:
 * they hold one id, and removing it clears the column.
 *
 * A row whose lists do not contain any of the ids yields no edit at all rather
 * than an edit to its own value — thirty no-op PATCHes would each write an audit
 * row saying nothing happened.
 */
export function removeGroupsFrom(
  targets: ChatTarget[],
  rowFor: (target: ChatTarget) => ProjectConfigRow | undefined,
  chatIds: string[],
  nameFor: (chatId: string) => string,
): RowEdit[] {
  const doomed = new Set(chatIds);
  const edits: RowEdit[] = [];

  for (const target of targets) {
    const row = rowFor(target);
    if (!row) continue;
    const changes: Record<string, unknown> = {};
    const removed: string[] = [];

    for (const { column } of groupColumnsFor(target.service)) {
      const before = splitList((row as Record<string, unknown>)[column]);
      if (!before.length) continue;
      const after = before.filter((id) => !doomed.has(id));
      if (after.length === before.length) continue;
      removed.push(...before.filter((id) => doomed.has(id)).map(nameFor));
      // Written back in the stored shape: a comma-joined string, or null when
      // the column is now empty. An empty string would read as "set to blank"
      // in the diff where the truth is "no groups left".
      changes[column] = after.length ? after.join(", ") : null;
    }

    if (Object.keys(changes).length) {
      edits.push({ ...target, changes, detail: `removes ${removed.join(", ")}` });
    }
  }
  return edits;
}

/**
 * Apply the same column change to every row in scope.
 *
 * Rows already holding the value are skipped, so the review list is the rows
 * that will actually change and the count means what it says.
 */
export function applyToAll(
  targets: ChatTarget[],
  rowFor: (target: ChatTarget) => ProjectConfigRow | undefined,
  changes: Record<string, unknown>,
): RowEdit[] {
  const edits: RowEdit[] = [];
  for (const target of targets) {
    const row = rowFor(target);
    if (!row) continue;
    const mine: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(changes)) {
      const before = (row as Record<string, unknown>)[column] ?? null;
      if (JSON.stringify(before) === JSON.stringify(value ?? null)) continue;
      mine[column] = value;
    }
    if (Object.keys(mine).length) edits.push({ ...target, changes: mine });
  }
  return edits;
}

/**
 * The columns of a row that differ from their documented default.
 *
 * "Put CFC back to defaults" is a real request, and the naive reading of it is
 * dangerous: every column has a `default` in the spec, and for a delivery-group
 * column that default is `null`. Applying all of them would silently empty the
 * WhatsApp group lists of a live site — a project that then runs its cadences
 * and sends to nobody, which looks like working software.
 *
 * So only columns with a **non-null** default are reset. A column whose default
 * is null has no default worth applying: it is blank-by-nature (a sheet id, a
 * group list, a coordinate), and its value is the project's identity rather than
 * a setting. That leaves exactly what people mean by "the usual settings" —
 * cadences, formatters, windows, mutes.
 */
export function defaultsFor(
  fields: Record<string, { name: string; default?: unknown; readonly?: boolean; hidden?: boolean }>,
  row: ProjectConfigRow,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const field of Object.values(fields)) {
    if (field.readonly || field.hidden) continue;
    if (field.default === undefined || field.default === null) continue;
    const before = (row as Record<string, unknown>)[field.name] ?? null;
    if (JSON.stringify(before) === JSON.stringify(field.default)) continue;
    changes[field.name] = field.default;
  }
  return changes;
}

/* ------------------------------------------------------------------ *
 * What the model is allowed to say about a bulk request
 * ------------------------------------------------------------------ */

/**
 * A condition on the rows in scope, so a request can say WHICH of them.
 *
 * `resolveScope` answers "which projects is this sentence about" from codes, a
 * company, a service or the whole estate — none of which can express "the ones
 * whose scheduled reports are off". That gap made the model ask a question it
 * already knew the answer to, because the shape it replies in had no field for
 * the condition it had understood.
 *
 * Applied in code against the live row, so the model names a column and a
 * value and never decides which rows match.
 */
export type RowCondition = {
  column: string;
  op: "is" | "is-not" | "empty" | "not-empty" | "contains";
  /** Absent for the `empty` / `not-empty` forms. */
  value?: unknown;
};

/** Does one row satisfy every condition? An empty list matches everything. */
export function matchesConditions(row: ProjectConfigRow, conditions: RowCondition[]): boolean {
  return conditions.every((condition) => {
    const raw = (row as Record<string, unknown>)[condition.column];
    const text = String(raw ?? "").trim();
    switch (condition.op) {
      case "empty":
        return text === "";
      case "not-empty":
        return text !== "";
      case "contains":
        return text.toLowerCase().includes(String(condition.value ?? "").toLowerCase());
      case "is-not":
        return !sameValue(raw, condition.value);
      default:
        return sameValue(raw, condition.value);
    }
  });
}

/**
 * Loose equality, because a boolean column reaches here as `false` from the row
 * and often as `"false"` from the model, and a request that turns on nothing
 * because of that is worse than one that is slightly permissive.
 */
function sameValue(actual: unknown, wanted: unknown): boolean {
  if (actual === wanted) return true;
  const left = String(actual ?? "").trim().toLowerCase();
  const right = String(wanted ?? "").trim().toLowerCase();
  if (left === right) return true;
  // A column that is NULL in Postgres and `false` in the sentence: for a
  // boolean, "not set" and "off" are the same thing to everyone but the schema.
  const falsey = new Set(["false", "null", "", "no", "off"]);
  return falsey.has(left) && falsey.has(right);
}

/**
 * The model's correction to the scope this file guessed.
 *
 * `resolveScope` reads the sentence with keywords, and keywords cannot tell
 * "for all Wohhup projects" from "set company to Wohhup" — the second is the
 * VALUE being written, and reading it as a filter narrowed a 30-project request
 * to the 3 that already had that company. The model can see the difference, so
 * when it says the set is something else, its reading wins.
 */
export type ScopeOverride = {
  company?: string;
  services?: ServiceKey[];
  /**
   * The projects, named outright.
   *
   * The most direct thing the model can say, and safe because a code is matched
   * against rows that already exist — an invented one selects nothing. It is
   * given every project's current values, so "the ones whose scheduled reports
   * are off" is a question it can answer from the data rather than ask about.
   */
  codes?: string[];
  /** Every project, in the named services or the whole estate. */
  all?: boolean;
};

export type BulkOp =
  /**
   * "These projects do not exist yet."
   *
   * The onboarding path used to be reachable only through a keyword read of the
   * sentence, so a phrasing that read never recognised — "I need issue chaser
   * rows for every Wohhup site" — was answered as a change to projects that do
   * not exist. The model sees the request and the rows, so it can say this
   * itself and the request is re-read as a creation.
   */
  | { kind: "onboard"; summary: string }
  | { kind: "set"; changes: Record<string, unknown>; summary: string; where: RowCondition[]; scope: ScopeOverride | null }
  /** Remove delivery groups whose name matches `phrase`. Matching happens in code. */
  | { kind: "remove-groups"; phrase: string; summary: string; where: RowCondition[]; scope: ScopeOverride | null }
  | { kind: "defaults"; summary: string; where: RowCondition[]; scope: ScopeOverride | null }
  | { kind: "question"; question: string };

/**
 * Read the model's bulk answer.
 *
 * Deliberately strict about shape and deliberately dumb about meaning: the only
 * free-form value it accepts from the model for a group removal is the *phrase*,
 * never the list of chat ids. Which groups that phrase matches, and which rows
 * hold them, is decided by `matchGroupNames` and `removeGroupsFrom` — code the
 * operator's review list is generated from. A model that hallucinated a chat id
 * would otherwise have removed a real group from a real site.
 */
export function parseBulkOp(parsed: Record<string, unknown> | null): BulkOp | null {
  if (!parsed) return null;
  const summary = String(parsed.summary ?? "").trim();

  if (typeof parsed.question === "string" && parsed.question.trim()) {
    return { kind: "question", question: parsed.question.trim() };
  }
  const op = String(parsed.op ?? "").trim();

  const where = readConditions(parsed.where);
  const scope = readScopeOverride(parsed.scope);

  if (op === "remove-groups") {
    const phrase = String(parsed.phrase ?? "").trim();
    if (!phrase) return null;
    return { kind: "remove-groups", phrase, summary, where, scope };
  }
  if (op === "onboard") return { kind: "onboard", summary };
  if (op === "defaults") return { kind: "defaults", summary, where, scope };
  if (op === "set") {
    const changes = parsed.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
    return { kind: "set", changes: changes as Record<string, unknown>, summary, where, scope };
  }
  // An op we do not recognise is not guessed at. `set` would be the tempting
  // default and the wrong one — it writes.
  return null;
}

/** A service key from either its key or its human label, case-insensitively. */
export function serviceKeyFor(value: string): ServiceKey | null {
  const wanted = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!wanted) return null;
  return (
    SERVICE_KEYS.find((key) => key.toLowerCase() === wanted) ??
    SERVICE_KEYS.find((key) => SERVICES[key].label.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted) ??
    null
  );
}

/** Read a scope correction, keeping only the parts that name real things. */
function readScopeOverride(raw: unknown): ScopeOverride | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const out: ScopeOverride = {};
  const company = String(entry.company ?? "").trim();
  if (company) out.company = company;
  // Key or label. The model is shown labels in the scope line — "Subcon
  // Activities" — and naturally answers with one; accepting only keys dropped
  // the whole correction and left the wrong scope in place, silently.
  const services = (Array.isArray(entry.services) ? entry.services : [])
    .map((value) => serviceKeyFor(String(value)))
    .filter((key): key is ServiceKey => Boolean(key));
  if (services.length) out.services = services;
  const codes = (Array.isArray(entry.codes) ? entry.codes : [])
    .map((code) => String(code).trim())
    .filter(Boolean);
  if (codes.length) out.codes = codes;
  if (entry.all === true) out.all = true;
  return Object.keys(out).length ? out : null;
}

/**
 * Re-resolve the affected rows from the model's correction.
 *
 * Still code that decides which rows match — the correction names a company, a
 * service or some codes, and this walks the real rows. A code that matches
 * nothing simply selects nothing.
 */
export function targetsForOverride(
  override: ScopeOverride,
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  idColumnFor: (service: ServiceKey) => string,
): ChatTarget[] {
  const services = override.services?.length ? override.services : [...SERVICE_KEYS];
  const wantedCodes = override.codes?.length
    ? new Set(override.codes.map((code) => code.trim().toLowerCase()))
    : null;
  const targets: ChatTarget[] = [];
  for (const service of services) {
    for (const row of rows[service] ?? []) {
      const code = String(row.project_code ?? "").trim();
      if (!code) continue;
      if (wantedCodes && !wantedCodes.has(code.toLowerCase())) continue;
      if (override.company && String(row.company ?? "").trim() !== override.company) continue;
      targets.push({
        service,
        projectCode: code,
        rowId: String((row as Record<string, unknown>)[idColumnFor(service)] ?? code),
      });
    }
  }
  return targets;
}

/** Read the model's conditions, dropping any it did not express properly. */
function readConditions(raw: unknown): RowCondition[] {
  const out: RowCondition[] = [];
  for (const entry of (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]) {
    const column = String(entry?.column ?? "").trim();
    const op = String(entry?.op ?? "is").trim() as RowCondition["op"];
    if (!column) continue;
    if (!["is", "is-not", "empty", "not-empty", "contains"].includes(op)) continue;
    out.push({ column, op, value: entry?.value });
  }
  return out;
}

/** How a condition reads in the review list's heading. */
export function describeConditions(conditions: RowCondition[]): string {
  return conditions
    .map((condition) => {
      if (condition.op === "empty") return `${condition.column} is empty`;
      if (condition.op === "not-empty") return `${condition.column} is set`;
      if (condition.op === "contains") return `${condition.column} contains "${condition.value}"`;
      const negated = condition.op === "is-not" ? " not" : "";
      return `${condition.column} is${negated} ${String(condition.value)}`;
    })
    .join(" and ");
}

/** How a corrected scope reads in one line. */
export function describeOverride(
  override: ScopeOverride,
  count: number,
  serviceLabelFor: (service: ServiceKey) => string,
): string {
  const plural = count === 1 ? "project" : "projects";
  const where = override.services?.length
    ? ` on ${override.services.map(serviceLabelFor).join(" / ")}`
    : "";
  if (override.codes?.length) return `${override.codes.join(", ")}${where}`;
  if (override.company) return `all ${count} ${override.company} ${plural}${where}`;
  return `all ${count} ${plural}${where || ", every service"}`;
}

/** How a scope reads in one line, for the review list's heading. */
export function describeScope(
  scope: Scope,
  serviceLabelFor: (service: ServiceKey) => string,
): string {
  const count = "targets" in scope ? scope.targets.length : 0;
  const plural = count === 1 ? "project" : "projects";
  switch (scope.kind) {
    case "projects":
      return scope.targets.map((t) => `${t.projectCode} (${serviceLabelFor(t.service)})`).join(", ");
    case "company":
      return `all ${count} ${scope.company} ${plural}` +
        (scope.services.length < SERVICE_KEYS.length
          ? ` on ${scope.services.map(serviceLabelFor).join(" / ")}`
          : " across every service");
    case "service":
      return `all ${count} ${scope.services.map(serviceLabelFor).join(" / ")} ${plural}`;
    case "estate":
      return `all ${count} ${plural}, every service`;
    default:
      return "no projects";
  }
}

/** The instruction for a request covering more than one project. Read by a test. */
export const BULK_SYSTEM_PROMPT = [
  "You turn one request from an operations engineer into a configuration change.",
  "",
  "You decide how many projects it covers. One, thirty, or none — that is your call and nothing decides it",
  "before you. There is no separate single-project path any more: a request about one project is this request",
  "with a scope of one, and the operator gets the right review screen either way.",
  "",
  "Interpret the request. It will arrive with typos, missing words, loose service names and sentences that do not",
  "parse — read through that to what was meant. Never refuse or narrow it because of how it is written, and never",
  "report a limitation you could work around: the rows and their values are below, so if a filter cannot express",
  "the set, work it out and name the projects in `scope.codes`.",
  "",
  "Decide both WHICH projects and WHAT to do to them. A scope read from keywords is stated below as a starting",
  "point and is often right, but it is a guess and you can replace it. You are also given every project in that",
  "service with its current values, so anything the request says about the state of a row — disabled, no group",
  "set, still on the default wording — is yours to work out rather than ask about.",
  "",
  "Nothing you return is written. It becomes a list the operator reads row by row and confirms, so an answer that",
  "acts on a reasonable reading is more useful than a question. Ask only when the request is genuinely ambiguous",
  "about the OUTCOME — not when it is merely specific about which rows.",
  "",
  "Reply with JSON only, no prose, in one of these shapes:",
  '  {"op":"set","changes":{"<column>":<value>},"where":[<condition>],"scope":<scope>,"summary":"<one sentence>"}',
  '  {"op":"remove-groups","phrase":"<the group name as the person described it>","where":[<condition>],"summary":"<one sentence>"}',
  '  {"op":"defaults","where":[<condition>],"summary":"<one sentence>"}',
  '  {"op":"onboard","summary":"<one sentence>"}   // the request is to CREATE projects, not change existing ones',
  "",
  '  <condition> = {"column":"<column>","op":"is"|"is-not"|"empty"|"not-empty"|"contains","value":<value>}',
  '  {"question":"<what you need to know>"}',
  "",
  "Rules:",
  '- If the request is to CREATE projects that do not exist yet — "onboard", "add rows for", "we need issue',
  '  chaser set up for every Wohhup site" — answer {"op":"onboard"}. The request is then re-read by the part',
  "  that plans creations. Do not try to express it as a change to the rows below: those are the projects that",
  "  already exist, and the ones being asked for are not among them.",
  "- You are given every project in scope with its current values. Use them. If the request is about some of",
  '  those rows rather than all of them, decide which and name them: {"scope":{"codes":["A","B"]}}. Work it out',
  "  from the values in front of you rather than asking which ones were meant — the sentence already said, and a",
  "  question the data answers is a question that should not be asked.",
  '- The scope stated below was read with keywords and CAN BE WRONG. It cannot tell "for all Wohhup projects"',
  '  from "set company to Wohhup" — in the second, Wohhup is the value being written, not a filter. If the',
  '  sentence means a different set, say so: {"scope":{"company":"<name>"}|{"services":["<key>"]}|',
  '  {"codes":["<code>"]}|{"all":true}} and the rows are resolved again from it. Combine with "services" to',
  "  stay inside one service.",
  '- EXCLUSIONS ARE NORMAL AND YOU RESOLVE THEM. "all Wohhup WBGT projects except MBS", "every noise site but',
  '  TJR and CFC" — the named projects are being taken OUT, not selected. Return the set that remains, either',
  '  as {"scope":{"codes":[...]}} listing what stays, or as a `where` that excludes them. A code named after',
  "  except, but, excluding, apart from or other than is never the target. If one of the excluded codes does",
  "  not exist on that service, drop it and carry on — say so in the summary; it does not make the request",
  "  ambiguous and it is not worth a question.",
  "- `where` narrows the scope to the rows the sentence actually means. The scope below is every project the",
  "  sentence could be about; a request that says WHICH of them — \"the ones whose scheduled reports are off\",",
  '  "any with no delivery group", "the ones still on the default wording" — is a `where`, and it is applied in',
  "  code against the live row. Use it instead of asking whether the change should really cover everything: the",
  "  operator told you which ones, and an empty `where` silently changes rows they excluded.",
  "- `set` may span services. A column one service does not have is simply skipped there and reported, so say",
  "  what you mean and let each service take the part that applies to it.",
  '- `remove-groups` is for "take that WhatsApp group off these projects". Give only the PHRASE the person used',
  "  to describe the group — never a chat id, and never a list of them. Matching the phrase to real groups is",
  "  done in code, and the operator reviews the matches before anything is written.",
  '- `defaults` resets the cadence and formatter columns to their documented defaults. It never touches delivery',
  "  groups, sheet ids or coordinates.",
  "- Change the fewest columns that achieve what was asked.",
  "- If the sentence is ambiguous, or asks for something no column covers, ask a question instead of guessing.",
  "- Every change is read out to the operator before it is applied — project by project when there are several,",
  "  on the project's own card when there is one — so the summary must say what will happen in one plain",
  "  sentence.",
  "- Never ask which single project is meant. If the sentence covers several, act on several. If you genuinely",
  "  cannot tell what OUTCOME is wanted, ask about the outcome.",
].join("\n");
