import assert from "node:assert/strict";
import test from "node:test";

import {
  onboardTargetsIn,
  parseOnboardIntent,
  planOnboarding,
  resolveGroupPattern,
  saysOnboard,
  switchesIn,
  type OnboardIntent,
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
  carryColumns: ["spreadsheet_id"],
  valueColumns: ["spreadsheet_id", "safety_group_ids", "manpower_activity_outbound_group_id"],
};

test("the intent parser refuses what the model is not allowed to decide", () => {
  const base = { targets: ["subcon"], scope: { kind: "all" } };

  // An unknown source service must NOT quietly widen to every site — that would
  // onboard the whole estate off a typo.
  assert.equal(
    parseOnboardIntent({ ...base, scope: { kind: "in-service", service: "noize" } }, ALLOWED),
    null,
  );
  // No recognisable target is a refusal, not a guess.
  assert.equal(parseOnboardIntent({ targets: ["nonsense"], scope: { kind: "all" } }, ALLOWED), null);

  // A switch the target does not offer is reported, not written.
  const stray = parseOnboardIntent(
    { ...base, switches: { enable_housekeeping: false, enable_teleport: true } },
    ALLOWED,
  );
  assert.ok(stray && !("question" in stray));
  if (!stray || "question" in stray) return;
  assert.deepEqual(stray.switches, { enable_housekeeping: false });
  assert.match(stray.notes.join(" "), /enable_teleport/);

  // A carry the estate has not declared is reported, not performed.
  const carry = parseOnboardIntent(
    { ...base, carry: [{ column: "safety_sheet_id", from: "wbgt" }] },
    ALLOWED,
  );
  if (!carry || "question" in carry) return assert.fail("expected an intent");
  assert.deepEqual(carry.carry, []);
  assert.match(carry.notes.join(" "), /no such equivalence/i);

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
      scope: { kind: "in-service", service: "noise" },
      switches: {},
      values: {},
      fallbacks: {},
      carry: [],
      groupPattern: null,
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
    scope: { kind: "company" as const, company: "Wohhup" },
    switches: {},
    carry: [],
    groupPattern: null,
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
    { targets: ["subcon"], scope: { kind: "all" }, values: { not_a_column: "x" } },
    ALLOWED,
  );
  if (!read || "question" in read) return assert.fail("expected an intent");
  assert.deepEqual(read.values, {});
  assert.match(read.notes.join(" "), /not_a_column/);
});
