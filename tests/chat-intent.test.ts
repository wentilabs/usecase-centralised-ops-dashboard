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
import { previewsFor } from "../lib/message-previews";

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
    wbgt: [{ project_code: "CFC" }, { project_code: "ZRA" }, { project_code: "TEST" }] as ProjectConfigRow[],
    haze: [{ project_code: "CFC" }, { project_code: "TJR" }, { project_code: "TEST" }] as ProjectConfigRow[],
  };

  // One project, one service.
  const one = resolveTarget("mute ZRA on Sundays", rows, idColumnFor);
  assert.equal(one.kind, "one");
  assert.deepEqual(one.kind === "one" && one.target, { service: "wbgt", projectCode: "ZRA", rowId: "ZRA" });

  // Nothing named — a question, never a guess at which of ninety.
  assert.equal(resolveTarget("turn off Sunday messages", rows, idColumnFor).kind, "none");

  // A named service takes precedence over everything else in the sentence. This
  // is the case that used to answer with the services the person did NOT name:
  // "Lightning, TEST, ..." listed the six services that do have a TEST, while
  // Lightning has none.
  const withLightning: typeof rows = {
    ...rows,
    lightning: [{ project_code: "TJR" }, { project_code: "ZRA" }] as ProjectConfigRow[],
  };
  const missing = resolveTarget("Lightning, TEST, make it 0900 to 2000", withLightning, idColumnFor);
  assert.equal(missing.kind, "not-in-service");
  if (missing.kind === "not-in-service") {
    assert.deepEqual(missing.services, ["lightning"]);
    assert.deepEqual(missing.codes, ["TEST"], "and it says which code it could not find there");
  }

  // A service named with a code it DOES have resolves straight away, even though
  // that code exists elsewhere too.
  const inLightning = resolveTarget("Lightning TJR amber off", withLightning, idColumnFor);
  assert.equal(inLightning.kind, "one");
  assert.equal(inLightning.kind === "one" && inLightning.target.service, "lightning");

  // A service named with no code asks about that service rather than in general.
  const noCode = resolveTarget("turn off lightning amber alerts", withLightning, idColumnFor);
  assert.equal(noCode.kind, "none");
  assert.deepEqual(noCode.kind === "none" ? noCode.hinted : [], ["lightning"]);

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
  const brief = briefFor("haze", spec(), { remove_sunday_notifications: false } as ProjectConfigRow);
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

  // Several codes no longer end here at all — they resolve to several rows and
  // the model reads them. This branch is reached only when none of the names
  // matched anything, so it reports that rather than asking for one at a time.
  const several = describeAmbiguity(
    [
      { service: "wbgt", projectCode: "ZRA", rowId: "ZRA" },
      { service: "haze", projectCode: "ZRA", rowId: "ZRA" },
      { service: "wbgt", projectCode: "TJR", rowId: "TJR" },
    ],
    label,
  );
  assert.match(several, /ZRA and TJR/);
  assert.doesNotMatch(several, /one project at a time/, "several projects is an ordinary request now");
  // The duplicate ZRA is not listed twice — it is one project named once.
  assert.equal(several.match(/ZRA/g)?.length, 1);

  // A long list is capped rather than becoming a paragraph.
  const many = describeAmbiguity(
    ["A1", "B2", "C3", "D4", "E5"].map((code) => ({ service: "wbgt" as ServiceKey, projectCode: code, rowId: code })),
    label,
  );
  assert.match(many, /A1, B2, C3 and 2 more/);
});

test("the chat route cannot write, structurally", async () => {
  // The rule is that a chat turn NEVER changes configuration — proposing is the
  // whole of its job, and the write happens only when a person presses save in
  // the editor. That is worth asserting against the source rather than trusting,
  // because the failure mode is silent: a route that writes looks exactly like
  // one that proposes until a row moves.
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const route = await readFile(resolve("app/api/chat/route.ts"), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // None of the repository's writing helpers may be imported or called.
  for (const writer of ["updateConfig", "insertConfig", "insertRows", "callRpc", "clearFieldSpecCache"]) {
    assert.doesNotMatch(code, new RegExp(`\\b${writer}\\b`), `the chat route must not touch ${writer}`);
  }
  // Only the readers.
  assert.match(code, /getConfig|getFieldSpec|listConfigs/);

  // The one outbound request is the model call. Any other host would be a write
  // path in disguise.
  const urls = [...code.matchAll(/https?:\/\/[^"'`\s)]+/g)].map((match) => match[0]);
  for (const url of urls) {
    assert.match(url, /api\.openai\.com|api\.anthropic\.com/, `unexpected outbound URL: ${url}`);
  }

  // And it must not call HALO's own mutating endpoint on the caller's behalf.
  assert.doesNotMatch(code, /\/api\/config\//, "applying a change is the editor's job, not the chat's");
});

test("the model is told each column's default, because \"default\" is a real request", () => {
  const brief = briefFor("haze", spec(), { advisory_format: "wohhup" } as ProjectConfigRow);
  const format = brief.find((entry) => entry.name === "advisory_format")!;
  assert.equal(format.current, "wohhup", "what it is now");
  assert.equal(format.default, "default", "and what it would go back to");

  // The instruction has to say so, and say why guessing fails: noise's hourly
  // default is date_loc_name_12h_complete_list, which is NOT the similar-looking
  // 12h_complete_list, and not the first option either.
  assert.match(SYSTEM_PROMPT, /"default", "back to normal" or "the usual"/);
  assert.match(SYSTEM_PROMPT, /date_loc_name_12h_complete_list/);
  assert.match(SYSTEM_PROMPT, /never assume the default is the/);
  assert.match(SYSTEM_PROMPT, /Write that value explicitly rather than clearing the column/);
});

test("formatter options are described from the service's own documentation", () => {
  // The gap this closes: hourly_formatter's help text is empty and its five
  // option names are nearly identical, so a model choosing between
  // `12h_complete_list` and `date_loc_name_12h_complete_list` had only the
  // strings to go on. These summaries come from the formatter previews, which are
  // lifted from the noise repo's own MESSAGE_SHAPES.md — the same words the
  // operator reads behind the `?`.
  const notes = Object.fromEntries(
    previewsFor("noise", "hourly_formatter").map((preview) => [preview.value, preview.summary]),
  );
  assert.ok(notes.date_loc_name_12h_complete_list, "the default must be described");
  assert.ok(notes["12h_complete_list"], "and so must the one it is confused with");
  assert.notEqual(
    notes.date_loc_name_12h_complete_list,
    notes["12h_complete_list"],
    "two formats with identical descriptions would be indistinguishable to a model",
  );
  // The distinguishing words are in there rather than left to the option name.
  assert.match(notes.date_loc_name_12h_complete_list, /location/i);
});

test("an array column is checked element by element, not as a whole", () => {
  // The bug this fixes: the model correctly answered ["G","C"] for a text[]
  // column and checkProposal replied "must be one of G, C" — comparing the whole
  // array against the option list, which reads as a contradiction because it is.
  const arraySpec = {
    fields: {
      red_detection_types: {
        name: "red_detection_types",
        label: "Red strike types",
        type: "array",
        widget: "multi",
        options: ["G", "C"],
        default: ["G"],
        readonly: false,
        hidden: false,
        showIf: null,
        row: null,
      },
    },
    groups: [],
  } as unknown as ServiceFieldSpec;
  const row = { red_detection_types: ["G"] } as unknown as ProjectConfigRow;

  const both = checkProposal(arraySpec, row, { changes: { red_detection_types: ["G", "C"] }, summary: "" });
  assert.deepEqual(both.changes, { red_detection_types: ["G", "C"] });
  assert.deepEqual(both.problems, []);

  // A comma string is accepted and normalised, since PostgREST needs an array.
  const asText = checkProposal(arraySpec, row, { changes: { red_detection_types: "G, C" }, summary: "" });
  assert.deepEqual(asText.changes, { red_detection_types: ["G", "C"] });

  // A bad element is named, rather than the whole value being rejected opaquely.
  const bad = checkProposal(arraySpec, row, { changes: { red_detection_types: ["G", "X"] }, summary: "" });
  assert.deepEqual(bad.changes, {});
  assert.match(bad.problems[0].reason, /^X — allowed values are G, C$/);

  // And the same set in the same order is not a change.
  const same = checkProposal(arraySpec, row, { changes: { red_detection_types: ["G"] }, summary: "" });
  assert.deepEqual(same.changes, {});
});
