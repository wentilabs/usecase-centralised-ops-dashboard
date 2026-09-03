import assert from "node:assert/strict";
import test from "node:test";

import { planOnboarding, saysOnboard } from "../lib/chat-onboard";
import { onboardingFor } from "../lib/onboarding";
import { clusterProjects, type ServiceRow } from "../lib/project-identity";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";

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
