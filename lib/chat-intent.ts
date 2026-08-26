import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "./services";
import type { FieldSpec, ServiceFieldSpec } from "./field-spec";
import { previewsFor } from "./message-previews";

/**
 * The pure half of the smart chat.
 *
 * Two jobs, kept out of the route so they can be tested without a model or a
 * network: work out WHICH project a sentence is about, and check whatever the
 * model proposes against the field spec before any of it reaches a form.
 *
 * Resolving the project deterministically rather than asking the model is a
 * deliberate split. A project code is a string match against a list HALO already
 * has; handing that to an LLM adds a way to be confidently wrong about the one
 * part of the request that decides whose site gets changed. The model is left
 * with the job only it can do — mapping an outcome onto columns.
 */

export type ChatTarget = { service: ServiceKey; projectCode: string; rowId: string };

export type ResolveResult =
  | { kind: "one"; target: ChatTarget }
  /** No code matched. `hinted` carries any service the sentence did name. */
  | { kind: "none"; hinted: ServiceKey[] }
  /** Named more than one project, or one code that exists in several services. */
  | { kind: "many"; candidates: ChatTarget[] }
  /**
   * The sentence named a service AND a code, and that service does not have it.
   *
   * Worth its own answer. "Lightning, TEST, ..." used to come back listing the
   * six OTHER services that do have a TEST — factually true, and useless: it
   * ignored the service the person had just named. The honest reply is that
   * Lightning has no TEST.
   */
  | { kind: "not-in-service"; services: ServiceKey[]; codes: string[] };

/**
 * Codes are matched loosely enough to survive how people type them, and
 * strictly enough not to fire on a substring.
 *
 * "CR 106" and "CR106" are the same project; "cfc" and "CFC" are the same
 * project; and "TRI" must not match inside "TRIAL". So both sides are reduced to
 * bare alphanumerics and compared on a boundary, rather than with `includes`.
 */
function normalise(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function mentionsCode(prompt: string, projectCode: string): boolean {
  const code = normalise(projectCode);
  if (code.length < 2) return false;

  // Compared against TOKENS of the sentence, not a normalised copy of the whole
  // thing. Normalising the sentence first removes the spaces and punctuation
  // that are the boundaries — "CFC shouldn't…" becomes "CFCSHOULDNT", where CFC
  // looks like a prefix of a longer word and is rejected.
  const tokens = (prompt.match(/[A-Za-z0-9]+/g) ?? []).map((token) => token.toUpperCase());

  // Up to three consecutive tokens, so a code written with spaces or hyphens
  // still matches: "CR 106" against CR106, "C991 SGB" against C991-SGB.
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = "";
    for (let length = 0; length < 3 && start + length < tokens.length; length += 1) {
      joined += tokens[start + length];
      if (joined === code) return true;
      if (joined.length > code.length) break;
    }
  }
  return false;
}

/** Which service the sentence is about, when it says so. Used only to break ties. */
export function serviceHintsIn(prompt: string): ServiceKey[] {
  const text = prompt.toLowerCase();
  const hints: Record<ServiceKey, RegExp> = {
    wbgt: /\bwbgt\b|heat stress|water parade/,
    noise: /\bnoise\b|\bleq\b|\bd[bB]a?\b/,
    haze: /\bhaze\b|\bpsi\b|air quality/,
    lightning: /\blightning\b|\bstrike|\bamber\b|\bstop.work\b/,
    ailytics: /\bailytics\b|\bcctv\b/,
    subcon: /\bsubcon\b|housekeeping|manpower/,
    issueChaser: /\bchaser\b|issue chaser|safety issue/,
  };
  return SERVICE_KEYS.filter((key) => hints[key].test(text));
}

/**
 * Find the one project a sentence is about.
 *
 * `rows` is every project HALO can see, per service — the same data the cards
 * render from. Ambiguity is returned rather than resolved: two projects named, or
 * one code that exists under two services, is a question for the person, not a
 * coin flip. One project at a time is the whole design.
 */
export function resolveTarget(
  prompt: string,
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>,
  idColumnFor: (service: ServiceKey) => string,
): ResolveResult {
  const found: ChatTarget[] = [];
  for (const service of SERVICE_KEYS) {
    for (const row of rows[service] ?? []) {
      const projectCode = String(row.project_code ?? "").trim();
      if (!projectCode || !mentionsCode(prompt, projectCode)) continue;
      const rowId = String(row[idColumnFor(service)] ?? projectCode);
      found.push({ service, projectCode, rowId });
    }
  }

  const hints = serviceHintsIn(prompt);

  // A named service is the strongest signal in the sentence, so it is applied
  // FIRST rather than used to break a tie. Doing it the other way round is what
  // made "Lightning, TEST, ..." answer with a list of services that were not
  // Lightning.
  if (hints.length) {
    const inHinted = found.filter((entry) => hints.includes(entry.service));
    if (inHinted.length === 1) return { kind: "one", target: inHinted[0] };
    if (inHinted.length > 1) return { kind: "many", candidates: inHinted };
    // A code was named, just not in the service that was named with it.
    if (found.length) {
      return {
        kind: "not-in-service",
        services: hints,
        codes: [...new Set(found.map((entry) => entry.projectCode))],
      };
    }
    return { kind: "none", hinted: hints };
  }

  if (found.length === 0) return { kind: "none", hinted: [] };
  if (found.length === 1) return { kind: "one", target: found[0] };
  return { kind: "many", candidates: found };
}

/**
 * How to describe an ambiguous match back to the person.
 *
 * Two different situations wear the same shape and need different sentences. One
 * code that exists under several services is "say which service"; several codes
 * is "one at a time". Listing all eight candidates for both, as the first version
 * did, answered neither question.
 */
export function describeAmbiguity(
  candidates: ChatTarget[],
  serviceLabelFor: (service: ServiceKey) => string,
): string {
  const codes = [...new Set(candidates.map((candidate) => candidate.projectCode))];

  if (codes.length === 1) {
    const services = [...new Set(candidates.map((candidate) => serviceLabelFor(candidate.service)))];
    const listed = services.length > 1
      ? `${services.slice(0, -1).join(", ")} and ${services[services.length - 1]}`
      : services[0];
    return `${codes[0]} exists for ${listed}. Say which service you mean.`;
  }

  const listed = codes.length > 3
    ? `${codes.slice(0, 3).join(", ")} and ${codes.length - 3} more`
    : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
  return `You named ${listed} — this handles one project at a time. Ask for one, then the next.`;
}

/**
 * What the model is told about a column.
 *
 * Deliberately the same label and help text the editor shows a person. That text
 * is the semantic layer — it is what maps "stop Sunday messages" onto one
 * boolean out of forty-two — so the model and the operator work from one
 * description rather than two.
 */
export type ColumnBrief = {
  name: string;
  label: string;
  help?: string;
  type: string;
  options?: string[];
  current: unknown;
  /**
   * The column's own default.
   *
   * Included because "put it back to default" is a real request and the answer is
   * never guessable from the option list. Noise's `hourly_formatter` has five
   * options and the default is `date_loc_name_12h_complete_list` — not the
   * similarly-named `12h_complete_list`, which is a different message shape.
   * Without this the model picks the plausible one.
   */
  default?: unknown;
  /**
   * What each option actually produces, one line per value.
   *
   * Taken from the formatter previews — which are themselves lifted from the
   * service repos' own `MESSAGE_SHAPES.md` — so the model reads the same
   * description of a message shape that the operator reads behind the `?`, and
   * both come from the service's documentation rather than from a name.
   *
   * This matters most where the names are nearly identical. Noise's
   * `hourly_formatter` offers `12h_complete_list` and
   * `date_loc_name_12h_complete_list`; the difference is a date line and the
   * location name in each meter heading, which no amount of staring at the two
   * strings will tell you.
   */
  optionNotes?: Record<string, string>;
};

export function briefFor(service: ServiceKey, spec: ServiceFieldSpec, row: ProjectConfigRow): ColumnBrief[] {
  return Object.values(spec.fields)
    .filter((field) => !field.hidden && !field.readonly)
    .map((field) => {
      const notes = Object.fromEntries(
        previewsFor(service, field.name)
          .filter((preview) => preview.summary)
          .map((preview) => [preview.value, preview.summary]),
      );
      return {
        name: field.name,
        label: field.label,
        ...(field.help ? { help: field.help } : {}),
        // `string` is the introspected default for a column whose type HALO does
        // not classify further; the model treats it as free text.
        type: field.type ?? "string",
        ...(field.options ? { options: [...field.options] } : {}),
        current: (row as Record<string, unknown>)[field.name] ?? null,
        ...(field.default === undefined ? {} : { default: field.default }),
        ...(Object.keys(notes).length ? { optionNotes: notes } : {}),
      };
    });
}

export type Proposal = {
  /** Column → the value to write. */
  changes: Record<string, unknown>;
  /** One sentence, shown above the diff, saying what this does. */
  summary: string;
};

export type ProposalProblem = { column: string; reason: string };

/**
 * Check a proposal against the spec before it reaches a form.
 *
 * The editor's own PATCH is validated again server-side by `validateChanges`, so
 * this is not the security boundary — it is there to turn a model's mistake into
 * a sentence the person reads, instead of a rejected save they have to decode.
 */
export function checkProposal(
  spec: ServiceFieldSpec,
  row: ProjectConfigRow,
  proposal: Proposal,
): { changes: Record<string, unknown>; problems: ProposalProblem[] } {
  const changes: Record<string, unknown> = {};
  const problems: ProposalProblem[] = [];

  for (const [column, value] of Object.entries(proposal.changes ?? {})) {
    const field: FieldSpec | undefined = spec.fields[column];
    if (!field) {
      problems.push({ column, reason: "no such column on this service" });
      continue;
    }
    if (field.readonly) {
      problems.push({ column, reason: "read-only" });
      continue;
    }
    if (field.hidden) {
      problems.push({ column, reason: "not editable from the dashboard" });
      continue;
    }
    // Array columns — lightning's strike types — are validated element by
    // element. Comparing the whole array against the option list rejected a
    // correct answer: the model returned ["G","C"] and this said "must be one of
    // G, C", which reads like a contradiction because it was one.
    const isArrayColumn = field.type === "array" || field.widget === "multi";
    if (isArrayColumn) {
      const values = Array.isArray(value)
        ? value.map(String)
        : String(value ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
      const bad = field.options ? values.filter((entry) => !field.options!.includes(entry)) : [];
      if (bad.length) {
        problems.push({
          column,
          reason: `${bad.join(", ")} — allowed values are ${(field.options ?? []).join(", ")}`,
        });
        continue;
      }
      // Normalised to an array whatever shape it arrived in, because that is
      // what PostgREST needs for a text[] column.
      const before = (row as Record<string, unknown>)[column] ?? null;
      if (JSON.stringify(before) === JSON.stringify(values)) continue;
      changes[column] = values;
      continue;
    }
    if (field.options && value !== null && value !== "" && !field.options.includes(String(value))) {
      problems.push({ column, reason: `must be one of ${field.options.join(", ")}` });
      continue;
    }
    if (field.type === "boolean" && typeof value !== "boolean") {
      problems.push({ column, reason: "must be true or false" });
      continue;
    }
    if (field.type === "number" && value !== null && !Number.isFinite(Number(value))) {
      problems.push({ column, reason: "must be a number" });
      continue;
    }
    // A change that changes nothing is dropped rather than shown as a diff of
    // one column to its own value.
    const before = (row as Record<string, unknown>)[column] ?? null;
    if (JSON.stringify(before) === JSON.stringify(value ?? null)) continue;
    changes[column] = value;
  }

  return { changes, problems };
}

/**
 * The model is asked for JSON; this survives it wrapping the JSON in prose.
 *
 * No JSON-mode parameter is sent — see `lib/chat-provider.ts` for why — so the
 * parser is the thing that has to be forgiving. It handles a fenced block, a bare
 * object, and either surrounded by explanation.
 */
export function parseModelJson(
  text: string,
): { changes?: unknown; summary?: unknown; question?: unknown } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The instruction the model is given. Kept here so a test can read it. */
export const SYSTEM_PROMPT = [
  "You turn one sentence from an operations engineer into a configuration change for ONE project.",
  "",
  "You are given that project's editable columns, each with the label and help text the dashboard shows a",
  "person, its type, its allowed values where it has them, and its current value.",
  "",
  "Reply with JSON only, no prose around it, in one of two shapes:",
  '  {"changes": {"<column>": <value>}, "summary": "<one sentence>"}',
  '  {"question": "<what you need to know>"}',
  "",
  "Rules:",
  "- Only columns from the list. Never invent one, and never guess at a column whose help text does not match",
  "  what was asked.",
  "- Booleans are true/false, not strings. Numbers are numbers. A value with allowed options must be one of them.",
  "- Change the fewest columns that achieve what was asked.",
  "- If the sentence is ambiguous, asks for something no column covers, or would need more than one project,",
  "  ask a question instead of guessing.",
  "- Never propose a change whose effect you cannot state in the summary.",
  "- `enabled` switches a whole project off. Only touch it if the sentence plainly asks for that.",
  '- "default", "back to normal" or "the usual" means the column\'s `default` value, which is given for each',
  "  column. Write that value explicitly rather than clearing the column, and never assume the default is the",
  "  first option or the one with the simplest name — noise's hourly default is `date_loc_name_12h_complete_list`,",
  "  not the similar-looking `12h_complete_list`.",
].join("\n");
