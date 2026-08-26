import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_PROMPT,
  briefFor,
  checkProposal,
  describeAmbiguity,
  mentionsCode,
  resolveTarget,
  serviceHintsIn,
} from "../lib/chat-intent";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";
import type { ServiceFieldSpec } from "../lib/field-spec";

const idColumnFor = (service: ServiceKey) => (service === "subcon" || service === "ailytics" ? "id" : "project_code");

test("a project code is matched the way people type it, and not inside another word", () => {
  assert.ok(mentionsCode("CFC shouldn't send on Sundays", "CFC"));
  assert.ok(mentionsCode("cfc alerts are too noisy", "CFC"), "case does not matter");
  // "CR 106" and "CR106" are one project typed two ways.
  assert.ok(mentionsCode("CR 106 should stop overnight", "CR106"));
  assert.ok(mentionsCode("turn CR106 down", "CR 106"));
  assert.ok(mentionsCode("mute TJR on holidays", "TJR"));

  // The failures that matter: a code must not fire on a longer token, or every
  // sentence about C991 would also hit C99.
  assert.equal(mentionsCode("this is a TRIAL run", "TRI"), false);
  assert.equal(mentionsCode("C991 is fine", "C99"), false);
  assert.equal(mentionsCode("nothing here", "CFC"), false);
  // ...but the longer code still matches when it is the one named.
  assert.ok(mentionsCode("C991 is fine", "C991"));
});

test("the project is resolved without asking a model, and ambiguity is returned", () => {
  const rows: Partial<Record<ServiceKey, ProjectConfigRow[]>> = {
    wbgt: [{ project_code: "CFC" }, { project_code: "ZRA" }] as ProjectConfigRow[],
    haze: [{ project_code: "CFC" }, { project_code: "TJR" }] as ProjectConfigRow[],
  };

  // One project, one service.
  const one = resolveTarget("mute ZRA on Sundays", rows, idColumnFor);
  assert.equal(one.kind, "one");
  assert.deepEqual(one.kind === "one" && one.target, { service: "wbgt", projectCode: "ZRA", rowId: "ZRA" });

  // Nothing named — a question, never a guess at which of ninety.
  assert.equal(resolveTarget("turn off Sunday messages", rows, idColumnFor).kind, "none");

  // Two different projects named: the design is one at a time.
  assert.equal(resolveTarget("set ZRA and TJR to four-hourly", rows, idColumnFor).kind, "many");

  // One code that exists under two services is ambiguous...
  assert.equal(resolveTarget("CFC should stop on Sundays", rows, idColumnFor).kind, "many");
  // ...unless the sentence says which service.
  const narrowed = resolveTarget("CFC's haze alerts should stop on Sundays", rows, idColumnFor);
  assert.equal(narrowed.kind, "one");
  assert.equal(narrowed.kind === "one" && narrowed.target.service, "haze");
});

test("service hints read the words an engineer would actually use", () => {
  assert.deepEqual(serviceHintsIn("the WBGT alerts"), ["wbgt"]);
  assert.deepEqual(serviceHintsIn("PSI is high"), ["haze"]);
  assert.deepEqual(serviceHintsIn("stop-work on strikes"), ["lightning"]);
  assert.deepEqual(serviceHintsIn("housekeeping intake"), ["subcon"]);
  assert.deepEqual(serviceHintsIn("nothing in particular"), []);
});

const spec = (): ServiceFieldSpec => ({
  fields: {
    remove_sunday_notifications: {
      name: "remove_sunday_notifications",
      label: "Mute Sundays",
      help: "Outbound only.",
      type: "boolean",
      widget: "toggle",
      options: null,
      default: false,
      readonly: false,
      hidden: false,
      showIf: null,
      row: null,
    },
    advisory_format: {
      name: "advisory_format",
      label: "Advisory format",
      type: "string",
      widget: "select",
      options: ["default", "wohhup"],
      default: "default",
      readonly: false,
      hidden: false,
      showIf: null,
      row: null,
    },
    site_hours_start: {
      name: "site_hours_start",
      label: "Site hours start",
      type: "number",
      widget: "number",
      options: null,
      default: 8,
      readonly: false,
      hidden: false,
      showIf: null,
      row: null,
    },
    project_code: {
      name: "project_code",
      label: "project_code",
      type: "string",
      widget: "text",
      options: null,
      default: null,
      readonly: true,
      hidden: true,
      showIf: null,
      row: null,
    },
  },
  groups: [],
}) as unknown as ServiceFieldSpec;

test("the model is briefed with the same words the operator reads", () => {
  const brief = briefFor(spec(), { remove_sunday_notifications: false } as ProjectConfigRow);
  const sunday = brief.find((entry) => entry.name === "remove_sunday_notifications")!;
  assert.equal(sunday.label, "Mute Sundays");
  assert.equal(sunday.help, "Outbound only.", "the help text IS the semantic layer");
  assert.equal(sunday.current, false, "and the current value, so it can tell a no-op from a change");

  // Identity and audit columns are not offered at all.
  assert.equal(brief.some((entry) => entry.name === "project_code"), false);
});

test("a proposal is checked before it reaches the form", () => {
  const row = { remove_sunday_notifications: false, advisory_format: "default", site_hours_start: 8 } as ProjectConfigRow;

  // The good case passes through untouched.
  const good = checkProposal(spec(), row, {
    changes: { remove_sunday_notifications: true },
    summary: "Stops Sunday sends.",
  });
  assert.deepEqual(good.changes, { remove_sunday_notifications: true });
  assert.deepEqual(good.problems, []);

  // Every way a model gets this wrong, turned into a sentence rather than a
  // rejected save the person has to decode.
  const bad = checkProposal(spec(), row, {
    changes: {
      made_up_column: true,
      project_code: "OTHER",
      advisory_format: "wohup",
      remove_sunday_notifications: "yes",
      site_hours_start: "eight",
    },
    summary: "…",
  });
  assert.deepEqual(bad.changes, {}, "nothing questionable gets through");
  const reasons = Object.fromEntries(bad.problems.map((p) => [p.column, p.reason]));
  assert.match(reasons.made_up_column, /no such column/);
  assert.match(reasons.project_code, /read-only|not editable/);
  assert.match(reasons.advisory_format, /must be one of default, wohhup/);
  assert.match(reasons.remove_sunday_notifications, /true or false/);
  assert.match(reasons.site_hours_start, /must be a number/);

  // A change to the value a column already holds is not a change.
  const noop = checkProposal(spec(), row, {
    changes: { remove_sunday_notifications: false },
    summary: "…",
  });
  assert.deepEqual(noop.changes, {});
  assert.deepEqual(noop.problems, []);
});

test("the instruction tells the model to ask rather than guess", () => {
  assert.match(SYSTEM_PROMPT, /ONE project/);
  assert.match(SYSTEM_PROMPT, /ask a question instead of guessing/);
  assert.match(SYSTEM_PROMPT, /Never invent one/);
  // `enabled` is the one column where a wrong guess takes a site's alerts down.
  assert.match(SYSTEM_PROMPT, /`enabled` switches a whole project off/);
  assert.match(SYSTEM_PROMPT, /JSON only/);
});

test("a hyphenated code matches however it is spaced", () => {
  // Real codes in the estate: C991-SGB, CR106-LOY, C992-SYT.
  for (const written of ["C991-SGB", "C991 SGB", "c991sgb", "C991 - SGB"]) {
    assert.ok(mentionsCode(`please update ${written} today`, "C991-SGB"), written);
  }
  // And still does not fire on a near miss.
  assert.equal(mentionsCode("C991-SYT is different", "C991-SGB"), false);
  assert.equal(mentionsCode("C991 alone", "C991-SGB"), false);
});

test("the two kinds of ambiguity get two different answers", () => {
  const label = (service: ServiceKey) =>
    ({ wbgt: "WBGT", noise: "Noise", haze: "Haze", lightning: "Lightning", ailytics: "Ailytics", subcon: "Subcon Activities", issueChaser: "Issue Chaser" })[service];

  // One code under several services: the question is which service.
  const shared = describeAmbiguity(
    [
      { service: "wbgt", projectCode: "CFC", rowId: "CFC" },
      { service: "haze", projectCode: "CFC", rowId: "CFC" },
      { service: "lightning", projectCode: "CFC", rowId: "CFC" },
    ],
    label,
  );
  assert.match(shared, /CFC exists for WBGT, Haze and Lightning/);
  assert.match(shared, /which service/);
  assert.doesNotMatch(shared, /one project at a time/, "that is the other problem");

  // Several codes: the question is which project, and the answer is one at a time.
  const several = describeAmbiguity(
    [
      { service: "wbgt", projectCode: "ZRA", rowId: "ZRA" },
      { service: "haze", projectCode: "ZRA", rowId: "ZRA" },
      { service: "wbgt", projectCode: "TJR", rowId: "TJR" },
    ],
    label,
  );
  assert.match(several, /You named ZRA and TJR/);
  assert.match(several, /one project at a time/);
  // The duplicate ZRA is not listed twice — it is one project named once.
  assert.equal(several.match(/ZRA/g)?.length, 1);

  // A long list is capped rather than becoming a paragraph.
  const many = describeAmbiguity(
    ["A1", "B2", "C3", "D4", "E5"].map((code) => ({ service: "wbgt" as ServiceKey, projectCode: code, rowId: code })),
    label,
  );
  assert.match(many, /A1, B2, C3 and 2 more/);
});
