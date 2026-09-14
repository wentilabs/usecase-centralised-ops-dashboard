import type { Cluster } from "../project-identity";
import { SERVICES, type ProjectConfigRow, type ServiceKey } from "../services";
import { CARRIED_FROM, carryColumnsFor, clusterCompany } from "./planner";

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

