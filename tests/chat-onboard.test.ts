import assert from "node:assert/strict";
import test from "node:test";

import {
  ONBOARD_INTENT_PROMPT,
  onboardTargetsIn,
  parseOnboardIntent,
  planOnboarding,
  resolveGroupPattern,
  saysOnboard,
  siteTableFor,
  switchesIn,
  type OnboardIntent,
  type SiteFilter,
} from "../lib/chat-onboard";
import { onboardingFor } from "../lib/onboarding";
import { clusterProjects, type ServiceRow } from "../lib/project-identity";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";

/** Real-shaped, because validateDraft checks the id looks like a Sheet id. */
const SHEET_ID = "1fsbJ04eSqfaGUBTO_HN7d0s8aafjQEftRoXLEziDe40";
const OTHER_SHEET_ID = "1LStoAHwBgdnXeTviMDgaPwV52gHm779YtzbgDUfQdvg";

const ENV = {
  ISSUE_CHASER_LAMBDA_URL: "https://x/send-message",
  SUBCON_LAMBDA_URL: "https://x/send-message",
  WHATSAPP_INSTANCE: "wohhup",
  WHATSAPP_CLIENT_ID: "wohhup",
};

function row(service: ServiceKey, projectCode: string, extra: Record<string, unknown> = {}): ServiceRow {
  return { service, projectCode, row: { project_code: projectCode, ...extra } as ProjectConfigRow };
}
const plan = (prompt: string, rows: ServiceRow[]) => {
  const byService = (service: ServiceKey) =>
    rows.filter((r) => r.service === service).map((r) => r.row);
  return planOnboarding({ prompt, clusters: clusterProjects(rows), existingFor: byService, env: ENV });
};

test("the router tolerates typos, because it decides whether anything reads the request", () => {
  // The failure this fixes: "onbaord isue chaserr projcts for all wohup sits"
  // is plainly an onboarding request, and a literal regex sent it to the
  // single-project path where it died as "Which project?" — no model ever saw
  // it. A router that fails on a slip is worse than a loose one, because the
  // loose case ends in a preview and the strict case ends in a refusal.
  assert.equal(saysOnboard("onbaord isue chaserr projcts for all wohup sits"), true);
  assert.equal(saysOnboard("creat projcts in subcon"), true);
  assert.equal(saysOnboard("onbording for subcon activites"), true);
  // Two words reaching a one-word verb.
  assert.equal(saysOnboard("set up a project in wbgt"), true);

  // Tolerance must not blur the one distinction that matters: "add" is the verb
  // for editing far more often than for creating.
  assert.equal(saysOnboard("add these two groups to every Wohhup project"), false);
  assert.equal(saysOnboard("set company to wohhup for all disabled subcon projects"), false);
  assert.equal(saysOnboard("create a new group list for TRI"), false);
});

test("onboarding is recognised without stealing ordinary edits", () => {
  assert.equal(saysOnboard("onboard every Wohhup project into issue chaser"), true);
  assert.equal(saysOnboard("create projects in subcon for all Wohhup sites"), true);
  assert.equal(saysOnboard("set up a project in wbgt for TRI"), true);
  assert.equal(saysOnboard("register the remaining sites in haze"), true);

  // "add" is the verb for both onboarding and editing, and editing is far more
  // common — reading it as onboarding would divert real edits to this path.
  assert.equal(saysOnboard("add the WL coordination group to CFC"), false);
  // The case that actually pins it: "add" alongside the word "project" is an
  // ordinary edit far more often than it is onboarding, and reading it as
  // onboarding would divert real edits into a create dialog.
  assert.equal(saysOnboard("add the safety group to the TRI project"), false);
  assert.equal(saysOnboard("add these two groups to every Wohhup project"), false);
  assert.equal(saysOnboard("add 120363@g.us to TRI's lightning groups"), false);
  assert.equal(saysOnboard("turn off Sunday alerts for CFC"), false);
  assert.equal(saysOnboard("remove all X WL groups from every project"), false);
  // `create` on its own is not enough — it is said about things that are not
  // projects.
  assert.equal(saysOnboard("create a new group list for TRI"), false);
});

test("it counts sites, not codes, so an alias is not onboarded twice", () => {
  // The whole reason this is safe to offer. CFC and Clifford Centre are one
  // site; onboarding by code would create two rows for it.
  const rows = [
    row("wbgt", "CFC", { company: "Wohhup" }),
    row("noise", "Clifford Centre", { company: "Wohhup" }),
    row("wbgt", "ZRB", { company: "Wohhup" }),
  ];
  const result = plan("onboard every Wohhup project into issue chaser", rows);
  assert.equal(result.kind, "plan");
  if (result.kind !== "plan") return;
  const chaser = result.services[0];
  const codes = [...chaser.ready, ...chaser.blocked].map((r) => r.projectCode).sort();
  assert.deepEqual(codes, ["CFC", "ZRB"], "one row per site, under the canonical code");
});

test("a site already in the target service is not created again", () => {
  const rows = [
    row("wbgt", "CFC", { company: "Wohhup" }),
    // Present in the target under its OTHER spelling — still present.
    row("issueChaser", "Clifford Centre", { company: "Wohhup" }),
    row("wbgt", "ZRB", { company: "Wohhup" }),
  ];
  const result = plan("onboard every Wohhup project into issue chaser", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const chaser = result.services[0];
  const proposed = [...chaser.ready, ...chaser.blocked].map((r) => r.projectCode);
  assert.deepEqual(proposed, ["ZRB"], "CFC is already there as Clifford Centre");
  assert.ok(
    chaser.alreadyThere.some((entry) => entry.existingAs === "Clifford Centre"),
    "and it is reported as already there, under the code actually in use",
  );
});

test("a required field nothing can answer blocks the row and is named", () => {
  // Issue chaser needs a Safety workbook id, which exists in no other service.
  // The request cannot be completed and the answer has to say why per row.
  const rows = [row("wbgt", "ZRB", { company: "Wohhup" })];
  const result = plan("onboard every Wohhup project into issue chaser", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const chaser = result.services[0];
  assert.deepEqual(chaser.ready, [], "nothing is created without the workbook");
  assert.equal(chaser.blocked.length, 1);
  assert.match(chaser.blocked[0].problems.join(" "), /workbook|sheet/i);
});

test("the company filter only takes sites that actually carry that company", () => {
  const rows = [
    row("wbgt", "WOH", { company: "Wohhup" }),
    row("wbgt", "OBA", { company: "Obayashi" }),
    row("wbgt", "BLANK", {}),
  ];
  const result = plan("onboard every Wohhup project into issue chaser", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const codes = [...result.services[0].ready, ...result.services[0].blocked].map((r) => r.projectCode);
  assert.deepEqual(codes, ["WOH"], "a blank company is not assumed to be the one asked for");
});

test("several target services are planned separately", () => {
  const rows = [row("wbgt", "ZRB", { company: "Wohhup" })];
  const result = plan("onboard every Wohhup project into issue chaser and subcon", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  assert.deepEqual(result.services.map((s) => s.service).sort(), ["issueChaser", "subcon"]);
});

test("an unnamed service is a question, not a guess", () => {
  const result = plan("onboard every Wohhup project", [row("wbgt", "ZRB", { company: "Wohhup" })]);
  assert.equal(result.kind, "question");
  if (result.kind !== "question") return;
  assert.match(result.question, /which service/i);
});

test("nothing left to onboard says so rather than returning an empty list", () => {
  const rows = [
    row("wbgt", "ZRB", { company: "Wohhup" }),
    row("issueChaser", "ZRB", { company: "Wohhup" }),
  ];
  const result = plan("onboard every Wohhup project into issue chaser", rows);
  assert.equal(result.kind, "question");
  if (result.kind !== "question") return;
  assert.match(result.question, /already onboarded/i);
});

test("the carried values are identity only, never a guessed workbook", () => {
  const rows = [row("wbgt", "ZRB", { company: "Wohhup", spreadsheet_id: "SHEET-FROM-WBGT" })];
  const result = plan("onboard every Wohhup project into subcon", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const proposed = [...result.services[0].ready, ...result.services[0].blocked][0];
  assert.equal(proposed.values.project_code, "ZRB");
  assert.equal(proposed.values.company, "Wohhup");
  // "Same key-values for similar fields" stops at fields that mean the same
  // thing. A WBGT monthly workbook is not a subcon manpower workbook, and
  // copying it would point the service at the wrong document.
  assert.ok(
    !Object.values(proposed.values).includes("SHEET-FROM-WBGT"),
    "a workbook id from another service must never be carried across",
  );
});

test("a service needing only a project code produces creatable rows", () => {
  // Noise and WBGT require nothing but the code, so these are the rows that
  // actually get written — the path the blocked-only tests never reach.
  const rows = [
    row("wbgt", "ZRB", { company: "Wohhup" }),
    row("wbgt", "CFC", { company: "Wohhup" }),
    row("noise", "CFC", { company: "Wohhup" }),
  ];
  const result = plan("onboard every Wohhup site into noise", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const noise = result.services[0];

  assert.deepEqual(noise.ready.map((r) => r.projectCode), ["ZRB"]);
  assert.deepEqual(noise.blocked, []);
  // CFC is in noise already, so it is not offered again.
  assert.deepEqual(noise.alreadyThere.map((entry) => entry.projectCode), ["CFC"]);

  const draft = noise.ready[0].values;
  assert.equal(draft.project_code, "ZRB");
  assert.equal(draft.company, "Wohhup");
  // "All given default options": the column defaults are filled in, which is
  // what makes the row creatable without asking anyone anything.
  assert.ok(
    Object.keys(draft).length > 2,
    `more than identity must be prefilled, got ${JSON.stringify(draft)}`,
  );
  // And nothing outside this service's own onboarding definition is invented.
  const allowed = new Set(onboardingFor("noise")!.fields.map((field) => field.column));
  for (const column of Object.keys(draft)) {
    assert.ok(allowed.has(column), `${column} is not a noise onboarding field`);
  }
});

test("the plan never proposes a code the target service would reject", () => {
  // Haze and lightning CHECK `^[A-Z0-9][A-Z0-9-]{0,47}$`, and canonical site
  // codes come from whatever the estate happens to spell them — "CR 106" has a
  // space and "Clifford Centre" has two words. Those must surface as blocked
  // rather than be sent to an insert Postgres will refuse.
  const rows = [
    row("wbgt", "CR 106", { company: "Wohhup", latitude: 1.3, longitude: 103.8 }),
  ];
  const result = plan("onboard every Wohhup site into haze", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const haze = result.services[0];
  assert.deepEqual(haze.ready, [], "a code with a space cannot be created in haze");
  assert.equal(haze.blocked.length, 1);
  assert.match(haze.blocked[0].problems.join(" "), /Project code is not valid|required/i);
});

test("switches are read from the sentence, per clause", () => {
  const columns = ["enable_housekeeping", "enable_manpower_summary", "enable_activity_summary"];

  // The sentence this was built for.
  const asked = switchesIn(
    "All set to not have housekeeping, but have manpower summary enabled (not the activity summary)",
    columns,
  );
  assert.deepEqual(asked.values, {
    enable_housekeeping: "false",
    enable_manpower_summary: "true",
    enable_activity_summary: "false",
  });
  assert.deepEqual(asked.unread, []);

  // Polarity is per clause. Without that, "no housekeeping" would negate every
  // switch after it and silence the report the sentence asks for.
  const mixed = switchesIn("no housekeeping but enable the manpower report", columns);
  assert.equal(mixed.values.enable_housekeeping, "false");
  assert.equal(mixed.values.enable_manpower_summary, "true");

  // The two summary names share a word; matching on "manpower" alone sets both.
  const activityOnly = switchesIn("turn on the activity + manpower summary", columns);
  assert.equal(activityOnly.values.enable_activity_summary, "true");
  assert.equal(activityOnly.values.enable_manpower_summary, undefined);

  // A switch nobody mentioned is left alone, not defaulted to false.
  const partial = switchesIn("disable housekeeping", columns);
  assert.deepEqual(Object.keys(partial.values), ["enable_housekeeping"]);
});

test("an unreadable switch is reported rather than guessed", () => {
  // Mentioned with no polarity either side. Guessing a boolean that starts or
  // silences a daily message to a site is not a reasonable thing to do quietly.
  const result = switchesIn("housekeeping", ["enable_housekeeping"]);
  assert.deepEqual(result.values, {});
  assert.deepEqual(result.unread, ["enable_housekeeping"]);
});

test("the sentence's switches reach the created row", () => {
  const rows = [row("wbgt", "ZRB", { company: "Wohhup", manpower_spreadsheet_id: SHEET_ID })];
  const result = plan(
    "onboard wohhup sites on subcon activities, not have housekeeping, but have manpower summary enabled (not the activity summary)",
    rows,
  );
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const draft = result.services[0].ready[0]?.values ?? result.services[0].blocked[0].values;
  assert.equal(draft.enable_housekeeping, "false");
  assert.equal(draft.enable_manpower_summary, "true");
  assert.equal(draft.enable_activity_summary, "false");
});

test("the manpower workbook is carried from WBGT, matched by site not by code", () => {
  // The whole reason this request is answerable. WBGT's manpower_spreadsheet_id
  // and subcon's spreadsheet_id are the same document — identical on ZRB, the
  // only project configured in both — and the identity map is what lets a value
  // written against "MBS" in WBGT reach a subcon row created as "IR2".
  const rows = [
    row("wbgt", "MBS", { company: "Wohhup", manpower_spreadsheet_id: SHEET_ID, whatsapp_group_id: "9@g.us" }),
    row("haze", "IR2", { company: "Wohhup", wa_group_ids: "9@g.us" }),
  ];
  const result = plan("onboard wohhup sites on subcon activities", rows);
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const created = result.services[0].ready[0];
  assert.ok(created, "the row is creatable once the workbook is carried");
  assert.equal(created.values.spreadsheet_id, SHEET_ID);
  assert.equal(created.derived.length, 1);
  assert.match(created.derived[0].from, /WBGT: MBS\.manpower_spreadsheet_id/);
  assert.match(created.derived[0].why, /Manpower workbook/i);
});

test("a service named as a source is not created in", () => {
  // The bug this exists for. "manpower sheet should follow whatever was written
  // in WBGT" names WBGT as somewhere to READ. Read as a target, that plan
  // proposed nine new WBGT projects on the live estate — and each WBGT create
  // runs DDL for a readings table, so a false positive here is schema, not a
  // stray row.
  const hints: ServiceKey[] = ["wbgt", "subcon"];
  assert.deepEqual(
    onboardTargetsIn(
      "onboard wohhup company sites on subcon activities, manpower sheet should follow whatever was written in WBGT",
      hints,
    ),
    ["subcon"],
  );
  assert.deepEqual(
    onboardTargetsIn("onboard wohhup sites into subcon, copying the sheet from wbgt", hints),
    ["subcon"],
  );
  // Two genuine targets are both kept.
  assert.deepEqual(
    onboardTargetsIn("onboard every wohhup site into issue chaser and subcon", ["subcon", "issueChaser"]),
    ["subcon", "issueChaser"],
  );
  // And a service named plainly is still a target, even though it is also the
  // source in the carry map.
  assert.deepEqual(onboardTargetsIn("onboard these into wbgt", ["wbgt"]), ["wbgt"]);

  // The cue only reaches one clause. A copy mentioned early in a long sentence
  // must not disqualify a target named much later — searching the whole
  // sentence would refuse the request outright.
  const farApart =
    "copy the settings from the old shared spreadsheet template, and then please onboard all wohhup company sites into subcon activities";
  assert.ok(farApart.toLowerCase().indexOf("subcon") - farApart.toLowerCase().indexOf("from") > 60);
  assert.deepEqual(onboardTargetsIn(farApart, ["subcon"]), ["subcon"]);
});

test("a sentence naming only sources asks rather than creating nothing", () => {
  const rows = [row("wbgt", "ZRB", { company: "Wohhup" })];
  const result = plan("onboard the wohhup sites, copying everything from wbgt", rows);
  assert.equal(result.kind, "question");
  if (result.kind !== "question") return;
  assert.match(result.question, /copy FROM/i);
});

test("the full request plans one target, not two", () => {
  // End to end on the sentence that exposed it.
  const rows = [
    row("wbgt", "ZRB", { company: "Wohhup", manpower_spreadsheet_id: SHEET_ID }),
    row("wbgt", "TRI", { company: "Wohhup", manpower_spreadsheet_id: SHEET_ID }),
  ];
  const result = plan(
    "I want to onboard wohhup company sites on subcon activities. All set to not have housekeeping, but have manpower summary enabled (not the activity summary), manpower sheet should follow whatever was written in WBGT, according to the site",
    rows,
  );
  if (result.kind !== "plan") return assert.fail("expected a plan");
  assert.deepEqual(result.services.map((entry) => entry.service), ["subcon"]);
  const created = result.services[0].ready;
  assert.equal(created.length, 2);
  for (const entry of created) {
    assert.equal(entry.values.enable_housekeeping, "false");
    assert.equal(entry.values.enable_manpower_summary, "true");
    assert.equal(entry.values.enable_activity_summary, "false");
    assert.equal(entry.values.spreadsheet_id, SHEET_ID);
  }
});

const ALLOWED = {
  services: ["wbgt", "noise", "haze", "lightning", "ailytics", "subcon", "issueChaser"] as ServiceKey[],
  switchColumns: ["enable_housekeeping", "enable_manpower_summary", "enable_activity_summary"],
  valueColumns: ["spreadsheet_id", "safety_group_ids", "manpower_activity_outbound_group_id"],
  declaredCarry: {
    spreadsheet_id: { from: "wbgt" as ServiceKey, column: "manpower_spreadsheet_id" },
  },
};

test("the intent parser refuses what the model is not allowed to decide", () => {
  const base = { targets: ["subcon"], scope: { include: [], exclude: [] } };

  // An unknown source service must NOT quietly widen to every site — that would
  // onboard the whole estate off a typo.
  assert.equal(
    parseOnboardIntent({ ...base, scope: { include: [{ kind: "in-service", service: "noize" }], exclude: [] } }, ALLOWED),
    null,
  );
  // No recognisable target is a refusal, not a guess.
  assert.equal(parseOnboardIntent({ targets: ["nonsense"], scope: { include: [], exclude: [] } }, ALLOWED), null);

  // A switch the target does not offer is reported, not written.
  const stray = parseOnboardIntent(
    { ...base, switches: { enable_housekeeping: false, enable_teleport: true } },
    ALLOWED,
  );
  assert.ok(stray && !("question" in stray));
  if (!stray || "question" in stray) return;
  assert.deepEqual(stray.switches, { enable_housekeeping: false });
  assert.match(stray.notes.join(" "), /enable_teleport/);

  // A carry the estate has not declared is HONOURED and marked unverified,
  // not refused. The preview is where a wrong document gets caught, and
  // refusing only meant the request quietly did less than it said.
  const carry = parseOnboardIntent(
    { ...base, carry: [{ column: "safety_sheet_id", from: "wbgt", fromColumn: "monthly_sheet_id" }] },
    ALLOWED,
  );
  if (!carry || "question" in carry) return assert.fail("expected an intent");
  assert.equal(carry.carry.length, 1);
  assert.equal(carry.carry[0].declared, false, "and it is flagged as unverified");
  // The declared one is marked as such.
  const declared = parseOnboardIntent(
    { ...base, carry: [{ column: "spreadsheet_id", from: "wbgt", fromColumn: "manpower_spreadsheet_id" }] },
    ALLOWED,
  );
  if (!declared || "question" in declared) return assert.fail("expected an intent");
  assert.equal(declared.carry[0].declared, true);

  // A non-boolean switch is left at its default rather than coerced.
  const fuzzy = parseOnboardIntent({ ...base, switches: { enable_housekeeping: "maybe" } }, ALLOWED);
  if (!fuzzy || "question" in fuzzy) return assert.fail("expected an intent");
  assert.deepEqual(fuzzy.switches, {});
  assert.match(fuzzy.notes.join(" "), /true or false/);
});

test("a group pattern is matched through the site's aliases", () => {
  const groups = [
    { chatId: "1@g.us", name: "CR106 x WL coordination" },
    { chatId: "2@g.us", name: "TBC x WL Coordination" },
    { chatId: "3@g.us", name: "Ailytics X Wenti (ZRA)" },
  ];
  // The chat is named for one alias and the source row uses another: TBC vs the
  // noise spelling TBCA. Matching on the canonical code alone would miss it.
  assert.equal(resolveGroupPattern("<site> x WL coordination", ["TBC", "TBCA"], groups)?.chatId, "2@g.us");
  assert.equal(
    resolveGroupPattern("<site> x WL coordination", ["CR 106", "CR106", "CR106-LOY"], groups)?.chatId,
    "1@g.us",
  );
  // No match leaves it empty rather than picking something close — a wrong
  // group is a report sent to the wrong people.
  assert.equal(resolveGroupPattern("<site> x WL coordination", ["ZRB"], groups), null);
  // Anchored at the start, so a short code cannot claim a longer site's chat.
  assert.equal(resolveGroupPattern("<site> x WL coordination", ["106"], groups), null);
});

test("in-service scope selects by membership, not by company", () => {
  const rows = [
    row("noise", "IN1", { company: "Wohhup" }),
    row("noise", "IN2", { company: "Obayashi" }),
    row("wbgt", "OUT1", { company: "Wohhup" }),
  ];
  const result = planOnboarding({
    prompt: "onboard subcon projects for every site on noise meters",
    intent: {
      targets: ["subcon"],
      scope: { include: [{ kind: "in-service", service: "noise" }], exclude: [] },
      switches: {},
      values: {},
      fallbacks: {},
      carry: [],
      groupPatterns: [],
      notes: [],
    },
    clusters: clusterProjects(rows),
    existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
    env: ENV,
  });
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const proposed = [...result.services[0].ready, ...result.services[0].blocked].map((r) => r.projectCode);
  // Both noise sites regardless of company; the WBGT-only site is out of scope.
  assert.deepEqual(proposed.sort(), ["IN1", "IN2"]);
  assert.match(result.summary, /configured in Noise/i);
});

test("a fallback fills only the gap, and a value overrides the carry", () => {
  // The instruction that had nowhere to go before: "if no applicable WBGT
  // manpower workbook is configured, use X". It must not touch the workbook
  // carried for the sites that DO have one.
  const rows = [
    row("wbgt", "HAS", { company: "Wohhup", manpower_spreadsheet_id: SHEET_ID }),
    row("wbgt", "NONE", { company: "Wohhup" }),
  ];
  const base = {
    targets: ["subcon"] as ServiceKey[],
    scope: { include: [{ kind: "company" as const, company: "Wohhup" }], exclude: [] },
    switches: {},
    carry: [],
    groupPatterns: [],
    notes: [],
  };
  const run = (extra: Partial<OnboardIntent>) =>
    planOnboarding({
      prompt: "onboard wohhup sites into subcon",
      intent: { ...base, values: {}, fallbacks: {}, ...extra } as OnboardIntent,
      clusters: clusterProjects(rows),
      existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
      env: ENV,
    });

  const withFallback = run({ fallbacks: { spreadsheet_id: OTHER_SHEET_ID } });
  if (withFallback.kind !== "plan") return assert.fail("expected a plan");
  const bySite = Object.fromEntries(
    [...withFallback.services[0].ready, ...withFallback.services[0].blocked].map((r) => [
      r.projectCode,
      r.values.spreadsheet_id,
    ]),
  );
  assert.equal(bySite.HAS, SHEET_ID, "the carried workbook must survive the fallback");
  assert.equal(bySite.NONE, OTHER_SHEET_ID, "and the gap is filled");

  // A plain value is an instruction, so it beats the carry.
  const withValue = run({ values: { spreadsheet_id: OTHER_SHEET_ID } });
  if (withValue.kind !== "plan") return assert.fail("expected a plan");
  const all = [...withValue.services[0].ready, ...withValue.services[0].blocked];
  for (const entry of all) assert.equal(entry.values.spreadsheet_id, OTHER_SHEET_ID);
});

test("a value for a column the service is not created with is reported", () => {
  const read = parseOnboardIntent(
    { targets: ["subcon"], scope: { include: [], exclude: [] }, values: { not_a_column: "x" } },
    ALLOWED,
  );
  if (!read || "question" in read) return assert.fail("expected an intent");
  assert.deepEqual(read.values, {});
  assert.match(read.notes.join(" "), /not_a_column/);
});

test("scope filters compose, and excludes win", () => {
  const rows = [
    row("noise", "A", { company: "Wohhup" }),
    row("noise", "B", { company: "Obayashi" }),
    row("wbgt", "C", { company: "Wohhup" }),
    row("noise", "D", { company: "Wohhup" }),
    row("wbgt", "D", { company: "Wohhup" }),
  ];
  const run = (scope: OnboardIntent["scope"]) =>
    planOnboarding({
      prompt: "onboard into subcon",
      intent: {
        targets: ["subcon"], scope, switches: {}, values: {}, fallbacks: {},
        carry: [], groupPatterns: [], notes: [],
      },
      clusters: clusterProjects(rows),
      existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
      env: ENV,
    });
  const codesOf = (result: ReturnType<typeof run>) => {
    if (result.kind !== "plan") return [];
    return [...result.services[0].ready, ...result.services[0].blocked].map((r) => r.projectCode).sort();
  };

  // Two includes INTERSECT. "All Wohhup sites that are also already in Noise"
  // was the first thing anyone asked for, and an OR-only list could not say it
  // — the model correctly refused rather than quietly widening the request.
  assert.deepEqual(
    codesOf(run({ include: [{ kind: "company", company: "Wohhup" }, { kind: "in-service", service: "noise" }], exclude: [] })),
    ["A", "D"],
    "Wohhup AND in noise",
  );
  // A union is still available, explicitly.
  assert.deepEqual(
    codesOf(
      run({
        include: [{ kind: "any", of: [{ kind: "company", company: "Obayashi" }, { kind: "codes", codes: ["A"] }] }],
        exclude: [],
      }),
    ),
    ["A", "B"],
  );
  // And the two compose: (Obayashi or A) that is also in noise.
  assert.deepEqual(
    codesOf(
      run({
        include: [
          { kind: "any", of: [{ kind: "company", company: "Obayashi" }, { kind: "codes", codes: ["A"] }] },
          { kind: "in-service", service: "noise" },
        ],
        exclude: [],
      }),
    ),
    ["A", "B"],
  );
  // An exclude wins over an include — "every Wohhup site except the ones in WBGT".
  assert.deepEqual(
    codesOf(run({ include: [{ kind: "company", company: "Wohhup" }], exclude: [{ kind: "in-service", service: "wbgt" }] })),
    ["A"],
  );
  // No includes means every site, so a sentence naming no scope still means something.
  assert.deepEqual(codesOf(run({ include: [], exclude: [] })), ["A", "B", "C", "D"]);
  // A code the estate does not have is a site nobody has configured yet, and
  // naming it asks for it to be created. It used to select nothing, which made
  // the dashboard able to onboard a site into its second service but never its
  // first — a new project was refused for being new.
  const brandNew = run({ include: [{ kind: "codes", codes: ["nope"] }], exclude: [] });
  assert.deepEqual(codesOf(brandNew), ["NOPE"], "an unknown code proposes a new site, upper-cased");
  if (brandNew.kind !== "plan") return assert.fail("expected a plan");
  const [proposed] = [...brandNew.services[0].ready, ...brandNew.services[0].blocked];
  assert.equal(proposed.isNew, true, "and is marked as new, because this is also what a typo looks like");
  assert.deepEqual(proposed.knownAs, [], "a new site is in no service by definition");
});

test("an undeclared copy is performed and flagged, not refused", () => {
  const rows = [row("wbgt", "ZRB", { company: "Wohhup", monthly_sheet_id: OTHER_SHEET_ID })];
  const result = planOnboarding({
    prompt: "onboard into subcon, taking the workbook from WBGT's monthly sheet",
    intent: {
      targets: ["subcon"],
      scope: { include: [], exclude: [] },
      switches: {}, values: {}, fallbacks: {},
      carry: [{ column: "spreadsheet_id", from: "wbgt", fromColumn: "monthly_sheet_id", declared: false }],
      groupPatterns: [], notes: [],
    },
    clusters: clusterProjects(rows),
    existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
    env: ENV,
  });
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const created = [...result.services[0].ready, ...result.services[0].blocked][0];
  assert.equal(created.values.spreadsheet_id, OTHER_SHEET_ID, "the copy is performed");
  const note = created.derived.find((d) => d.column === "spreadsheet_id");
  assert.match(note!.why, /not a declared equivalent/i, "and marked for checking");
});

test("several group patterns can be asked for at once", () => {
  const rows = [row("wbgt", "ZRB", { company: "Wohhup", manpower_spreadsheet_id: SHEET_ID })];
  const result = planOnboarding({
    prompt: "onboard into subcon with both groups",
    intent: {
      targets: ["subcon"],
      scope: { include: [], exclude: [] },
      switches: {}, values: {}, fallbacks: {}, carry: [],
      groupPatterns: [
        { column: "safety_group_ids", pattern: "<site> x WL coordination" },
        { column: "manpower_activity_outbound_group_id", pattern: "<site> reports" },
      ],
      notes: [],
    },
    clusters: clusterProjects(rows),
    existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
    env: ENV,
    groupNames: [
      { chatId: "a@g.us", name: "ZRB x WL coordination" },
      { chatId: "b@g.us", name: "ZRB reports" },
    ],
  });
  if (result.kind !== "plan") return assert.fail("expected a plan");
  const created = result.services[0].ready[0];
  assert.equal(created.values.safety_group_ids, "a@g.us");
  assert.equal(created.values.manpower_activity_outbound_group_id, "b@g.us");
});

test("the prompt promises the shape the parser accepts", () => {
  // The drift that actually happened: the intent shape grew composable scope
  // filters, multiple group patterns and an open carry, and the prompt was
  // left describing the old one. Everything type-checked, every test passed,
  // and the model kept answering in a shape the parser silently ignored — so
  // two excludes came back as prose notes and the plan covered 35 sites
  // instead of 27. Nothing else catches this.
  for (const field of ["targets", "scope", "switches", "values", "fallbacks", "carry", "template", "groupPatterns", "notes"]) {
    assert.match(ONBOARD_INTENT_PROMPT, new RegExp(`"${field}"`), `the prompt must document "${field}"`);
  }
  for (const kind of ["company", "in-service", "codes"]) {
    assert.match(ONBOARD_INTENT_PROMPT, new RegExp(`"${kind}"`), `the prompt must document the ${kind} filter`);
  }
  assert.match(ONBOARD_INTENT_PROMPT, /"include"/, "scope must be documented as include/exclude");
  assert.match(ONBOARD_INTENT_PROMPT, /"exclude"/);
  assert.match(ONBOARD_INTENT_PROMPT, /"fromColumn"/, "carry must document the source column");

  // And the shapes it no longer accepts must not still be promised.
  assert.doesNotMatch(ONBOARD_INTENT_PROMPT, /"kind":"all"/, "the old fixed scope is gone");
  assert.doesNotMatch(ONBOARD_INTENT_PROMPT, /"groupPattern":\s*\{/, "the single-pattern form is gone");

  // EVERY worked example must itself parse, or the prompt is teaching a shape
  // that fails. Brace-counted rather than line-matched: the prompt continues
  // past the examples, so a lastIndexOf sweep picks up unrelated text.
  const examples = ONBOARD_INTENT_PROMPT.slice(ONBOARD_INTENT_PROMPT.indexOf("Worked example."));
  const blocks: string[] = [];
  for (let at = 0; at < examples.length; at += 1) {
    if (examples[at] !== "{") continue;
    let depth = 0;
    for (let scan = at; scan < examples.length; scan += 1) {
      if (examples[scan] === "{") depth += 1;
      if (examples[scan] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(examples.slice(at, scan + 1));
        at = scan;
        break;
      }
    }
  }
  // The `<filter>` placeholders above the examples are not JSON; a block that
  // is not an intent at all would silently pass as "nothing to check".
  const intents = blocks.filter((block) => block.includes('"targets"'));
  assert.equal(intents.length, 2, "both worked examples must be found");

  const parseExample = (json: string) =>
    parseOnboardIntent(JSON.parse(json) as Record<string, unknown>, {
      ...ALLOWED,
      switchColumns: ["enable_housekeeping", "enable_manpower_summary", "enable_activity_summary"],
      valueColumns: ["spreadsheet_id"],
    });

  const parsed = parseExample(intents[0]);
  assert.ok(parsed && !("question" in parsed), "the worked example must parse");
  if (!parsed || "question" in parsed) return;
  assert.deepEqual(parsed.targets, ["subcon"]);
  assert.equal(parsed.scope.exclude.length, 2, "both excludes in the example must survive");
  assert.equal(parsed.carry[0]?.declared, true, "the example's carry is a declared pair");

  // The new-project example, which is the one the old prompt could not express
  // — it answered "which existing site did you mean?" instead.
  const fresh = parseExample(intents[1]);
  assert.ok(fresh && !("question" in fresh), "the new-project example must parse");
  if (!fresh || "question" in fresh) return;
  assert.deepEqual(fresh.scope.include, [{ kind: "codes", codes: ["TEST2"] }]);
  assert.deepEqual(fresh.template, { service: "issueChaser", projectCode: "TEST" });
});

test("the notes box means 'not applied', not 'mentioned'", () => {
  // It is rendered under "Not applied from your sentence". A note about
  // something that WAS applied — leaving a column empty that is empty by
  // default — buries the parts that really were dropped, which is the only
  // reason the box exists.
  assert.match(ONBOARD_INTENT_PROMPT, /Not applied from your sentence/);
  assert.match(ONBOARD_INTENT_PROMPT, /was applied, not skipped/);
});

test("the model is handed the estate, not a filter vocabulary", () => {
  // The point of the site table: with the estate in front of it, any selection
  // the model can reason about is expressible as `codes`, so no new filter kind
  // is ever needed. "Wohhup sites also already in Noise" was a missing AND;
  // the next request would have been a missing something-else.
  const rows = [
    row("wbgt", "MBS", { company: "Wohhup", whatsapp_group_id: "9@g.us" }),
    row("noise", "MBS IR2", { company: "Wohhup", whatsapp_group_id: "9@g.us" }),
    row("haze", "ZRB", { company: "Obayashi" }),
  ];
  const table = siteTableFor(clusterProjects(rows), (service) =>
    rows.filter((r) => r.service === service).map((r) => r.row),
  );
  // Per-service codes, so the model can see which services a site is missing
  // from without being told the rule for it.
  assert.match(table, /"site":"MBS"/);
  assert.match(table, /"wbgt":"MBS"/);
  assert.match(table, /"noise":"MBS IR2"/);
  assert.match(table, /"company":"Wohhup"/);
  // Aliases, so a code the operator used reaches the site it belongs to.
  assert.match(table, /"aliases":\["MBS","MBS IR2"\]/);
  // A site missing from a service simply has no entry for it, which is how the
  // model works out where a row still needs creating.
  assert.match(table, /"site":"ZRB","company":"Obayashi","in":\{"haze":"ZRB"\}/);
  // And it says codes are always available, which is what makes the vocabulary
  // non-limiting.
  assert.match(table, /scope\.codes/);
});

test("the prompt tells the model to read through typos rather than refuse", () => {
  assert.match(ONBOARD_INTENT_PROMPT, /typos/i);
  assert.match(ONBOARD_INTENT_PROMPT, /Never refuse or narrow/i);
  // The specific failure mode: reporting a limitation instead of working around it.
  assert.match(ONBOARD_INTENT_PROMPT, /never report a limitation you could work around/i);
  // And it must not still claim the scope is decided elsewhere.
  assert.doesNotMatch(ONBOARD_INTENT_PROMPT, /You do not decide WHICH projects/i);
});

test("a site can be selected by a condition on another service's row", () => {
  // The bulk path could already select on a row's values and this could not,
  // which was an asymmetry with nothing behind it. "Every Wohhup site whose
  // noise config is disabled" is one filter, not a follow-up question.
  const rows = [
    row("noise", "ON", { company: "Wohhup", enabled: true }),
    row("noise", "OFF", { company: "Wohhup", enabled: false }),
    row("noise", "BLANK", { company: "Wohhup" }),
  ];
  const run = (include: SiteFilter[]) =>
    planOnboarding({
      prompt: "onboard into subcon",
      intent: {
        targets: ["subcon"], scope: { include, exclude: [] },
        switches: {}, values: {}, fallbacks: {}, carry: [], groupPatterns: [], notes: [],
      },
      clusters: clusterProjects(rows),
      existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
      env: ENV,
    });
  const codesOf = (result: ReturnType<typeof run>) =>
    result.kind === "plan"
      ? [...result.services[0].ready, ...result.services[0].blocked].map((r) => r.projectCode).sort()
      : [];

  assert.deepEqual(
    codesOf(run([{ kind: "where", service: "noise", column: "enabled", op: "is", value: false }])),
    ["BLANK", "OFF"],
    "NULL counts as off, as it does everywhere else",
  );
  assert.deepEqual(
    codesOf(run([{ kind: "where", service: "noise", column: "enabled", op: "is", value: true }])),
    ["ON"],
  );
  // A site with no row in that service cannot satisfy a condition about it.
  assert.deepEqual(
    codesOf(run([{ kind: "where", service: "wbgt", column: "enabled", op: "is", value: false }])),
    [],
  );

  // And it composes with the rest.
  assert.deepEqual(
    codesOf(
      run([
        { kind: "company", company: "Wohhup" },
        { kind: "where", service: "noise", column: "enabled", op: "is", value: true },
      ]),
    ),
    ["ON"],
  );
});

test("an unreadable where filter is refused, never dropped", () => {
  // Dropping it from an INCLUDE silently widens the plan to every site, which
  // is the one direction a mistake here must not go.
  const base = { targets: ["subcon"], scope: { include: [], exclude: [] } };
  for (const bad of [
    { kind: "where", service: "noize", column: "enabled", op: "is", value: false },
    { kind: "where", service: "noise", op: "is", value: false },
    { kind: "where", service: "noise", column: "enabled", op: "roughly", value: false },
  ]) {
    assert.equal(
      parseOnboardIntent({ ...base, scope: { include: [bad], exclude: [] } }, ALLOWED),
      null,
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

test("a brand new project can be created, and templated from an existing one", () => {
  // The request that was refused: "add a new project TEST2 that has the exact
  // same configurations as TEST in issue chaser. It is a totally new project,
  // with no other services yet." The answer came back "TEST2 is not a site in
  // the estate identity map. Which existing canonical site should receive the
  // new Issue Chaser project row?" — which is the map being used as a gate on
  // creation. The map is built from rows that exist, so it can only ever say
  // no to the first project of a new site.
  const rows = [
    row("issueChaser", "TEST", {
      company: "Wohhup",
      safety_sheet_id: SHEET_ID,
      whatsapp_group_ids: "a@g.us,b@g.us",
      remove_sunday_notifications: true,
      lambda_url: "https://custom/send-message",
    }),
    row("issueChaser", "ZRA", { company: "Wohhup", safety_sheet_id: OTHER_SHEET_ID }),
  ];
  const run = (intent: Partial<OnboardIntent>) =>
    planOnboarding({
      prompt: "add a new project TEST2 with the same configuration as TEST in issue chaser",
      intent: {
        targets: ["issueChaser"],
        scope: { include: [{ kind: "codes", codes: ["TEST2"] }], exclude: [] },
        switches: {}, values: {}, fallbacks: {}, carry: [], groupPatterns: [], notes: [],
        ...intent,
      } as OnboardIntent,
      clusters: clusterProjects(rows),
      existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
      env: ENV,
    });

  // Without a template it is still proposed — the code alone is enough to
  // create a project — but it is short the one required field nothing supplies.
  const bare = run({});
  if (bare.kind !== "plan") return assert.fail(`expected a plan, got: ${bare.question}`);
  assert.deepEqual(bare.services[0].ready, [], "nothing is ready without a workbook");
  assert.equal(bare.services[0].blocked[0]?.projectCode, "TEST2");
  assert.match(bare.services[0].blocked[0]?.problems.join(" ") ?? "", /Safety workbook is required/i);

  const templated = run({ template: { service: "issueChaser", projectCode: "TEST" } });
  if (templated.kind !== "plan") return assert.fail(`expected a plan, got: ${templated.question}`);
  const [created] = templated.services[0].ready;
  assert.ok(created, `TEST2 should be ready: ${templated.services[0].blocked[0]?.problems.join(" ")}`);
  assert.equal(created.projectCode, "TEST2");
  assert.equal(created.isNew, true);

  // Every creatable column comes across, including the ones a required-field
  // check would not have caught.
  assert.equal(created.values.safety_sheet_id, SHEET_ID);
  assert.equal(created.values.whatsapp_group_ids, "a@g.us,b@g.us");
  assert.equal(created.values.remove_sunday_notifications, "true");
  // An env default loses to the template: "the same as TEST" means TEST's URL,
  // not the estate's.
  assert.equal(created.values.lambda_url, "https://custom/send-message");
  // Identity never does. The template is a different project.
  assert.equal(created.values.project_code, "TEST2");

  // And every copied value is listed, because a template carries chat ids —
  // pointing a new project at another project's WhatsApp group is precisely
  // what the review list is for.
  const copied = Object.fromEntries(created.derived.map((entry) => [entry.column, entry]));
  assert.equal(copied.whatsapp_group_ids?.from, "Issue Chaser: TEST.whatsapp_group_ids");
  assert.match(copied.whatsapp_group_ids?.why ?? "", /copied from TEST/);
  assert.equal(copied.project_code, undefined);

  // An explicit instruction still beats the template — a value, and a switch,
  // which is the one that decides whether a site gets a Sunday message.
  const overridden = run({
    template: { service: "issueChaser", projectCode: "TEST" },
    values: { safety_sheet_id: OTHER_SHEET_ID },
    switches: { remove_sunday_notifications: false },
  });
  if (overridden.kind !== "plan") return assert.fail("expected a plan");
  assert.equal(overridden.services[0].ready[0]?.values.safety_sheet_id, OTHER_SHEET_ID);
  assert.equal(overridden.services[0].ready[0]?.values.remove_sunday_notifications, "false");

  // A template can only carry columns the service is CREATED with, and saying
  // "the same as TEST" while quietly dropping the rest is the half-truth that
  // actually happened: the real TEST2 came out matching TEST on everything the
  // dialog asks about and differing on six columns nobody was told about.
  const partial = [
    row("issueChaser", "RICH", {
      company: "Wohhup",
      safety_sheet_id: SHEET_ID,
      // Not part of creating an issue-chaser row.
      daily_safety_summary_enabled: true,
      include_days_before_snapshot: 1,
      // Set, but false or empty, so naming it would be noise.
      same_day_open_snapshot_enabled: false,
      severity_p1_window_start: null,
      // A rule, not a gap — every row is created disabled and it is said so
      // elsewhere.
      enabled: true,
    }),
  ];
  const gaps = planOnboarding({
    prompt: "add RICH2 like RICH in issue chaser",
    intent: {
      targets: ["issueChaser"],
      scope: { include: [{ kind: "codes", codes: ["RICH2"] }], exclude: [] },
      template: { service: "issueChaser", projectCode: "RICH" },
      switches: {}, values: {}, fallbacks: {}, carry: [], groupPatterns: [], notes: [],
    },
    clusters: clusterProjects(partial),
    existingFor: (service) => partial.filter((r) => r.service === service).map((r) => r.row),
    env: ENV,
  });
  if (gaps.kind !== "plan") return assert.fail("expected a plan");
  const said = gaps.unread.join(" ");
  assert.match(said, /daily_safety_summary_enabled/);
  assert.match(said, /include_days_before_snapshot/);
  assert.match(said, /cannot set them/);
  assert.doesNotMatch(said, /same_day_open_snapshot_enabled/, "a column set to false is not a gap worth naming");
  assert.doesNotMatch(said, /severity_p1_window_start/, "nor is a null one");
  // Anchored on the separators, not on \b: every other column here ENDS in
  // "enabled", so a word boundary matches all of them and the check passes for
  // the wrong reason.
  assert.doesNotMatch(said, /(^|[\s,])enabled([\s,]|$)/, "rows are always created disabled; that is a rule, not a gap");
  // And it is a note, not a refusal: the row is still created.
  assert.equal(gaps.services[0].ready[0]?.projectCode, "RICH2");

  // A template naming a row that is not there copies nothing and says so,
  // rather than quietly producing an empty project.
  const missing = run({ template: { service: "issueChaser", projectCode: "NOSUCH" } });
  if (missing.kind !== "plan") return assert.fail("expected a plan");
  assert.match(missing.unread.join(" "), /nothing in Issue Chaser is called "NOSUCH"/);
  assert.equal(missing.services[0].ready.length, 0);
});

test("a new code that is already taken is caught before anything is written", () => {
  // The other half of letting the model name codes: the check that used to be
  // implicit in "it must be a site we know" has to be explicit now.
  const rows = [row("issueChaser", "ZRA", { company: "Wohhup", safety_sheet_id: SHEET_ID })];
  const result = planOnboarding({
    prompt: "add a new project zra to issue chaser",
    intent: {
      targets: ["issueChaser"],
      // Folded, so this selects the existing ZRA rather than inventing a site.
      scope: { include: [{ kind: "codes", codes: ["zra"] }], exclude: [] },
      switches: {}, values: {}, fallbacks: {}, carry: [], groupPatterns: [], notes: [],
    },
    clusters: clusterProjects(rows),
    existingFor: (service) => rows.filter((r) => r.service === service).map((r) => r.row),
    env: ENV,
  });
  if (result.kind !== "plan" && result.kind !== "question") return assert.fail("expected an answer");
  if (result.kind === "plan") {
    assert.deepEqual(result.services[0].ready, [], "an existing site is not created twice");
    assert.deepEqual(result.services[0].alreadyThere, [{ projectCode: "ZRA", existingAs: "ZRA" }]);
  } else {
    assert.match(result.question, /already onboarded/i);
  }
});
