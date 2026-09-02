import assert from "node:assert/strict";
import test from "node:test";

import { planOnboarding, saysOnboard } from "../lib/chat-onboard";
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
