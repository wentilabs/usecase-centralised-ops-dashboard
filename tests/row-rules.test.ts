import assert from "node:assert/strict";
import test from "node:test";

import { ROW_RULES, explainConstraint, newProblems, rowProblems } from "../lib/row-rules";
import { SERVICE_KEYS } from "../lib/services";

/** Labels the way the screen writes them, so the sentences read as they will. */
const LABELS: Record<string, string> = {
  enable_red_band_poc_mentions: "Red POC mentions",
  poc_phone_numbers: "POC phone numbers",
  poc_alert_wa_groups: "POC mention groups",
  enabled: "Project enabled",
  daily_safety_summary_enabled: "Daily safety summary",
  safety_summary_whatsapp_group_ids: "Summary groups",
  whatsapp_group_ids: "WhatsApp groups",
};
const label = (column: string) => LABELS[column] ?? column;

test("the red-mentions rule names the empty list, not the constraint", () => {
  // The save that produced the screenshot. Red POC mentions on, phone numbers
  // filled, mention groups empty — and what came back was
  //   violates check constraint "lightning_red_poc_mentions_check" —
  //   Failing row contains (JCU, 2 Jurong East Central 1, 1.333435, … [23514]
  // with nothing on screen saying which field was wrong.
  const [problem] = rowProblems(
    "lightning",
    {
      enable_red_band_poc_mentions: true,
      poc_phone_numbers: "6583356391,6582570972",
      poc_alert_wa_groups: "",
    },
    label,
  );
  assert.ok(problem, "the rule must fire");
  assert.match(problem.message, /POC mention groups/);
  assert.match(problem.message, /Red POC mentions is on/);
  // The field that IS filled must not be named — "needs a phone number" when
  // you have supplied four reads as though HALO cannot see them.
  assert.doesNotMatch(problem.message, /POC phone numbers/);
  // And the editor needs the columns to point at, including the toggle, since
  // turning it off is the other way to fix this.
  assert.deepEqual(problem.columns, [
    "enable_red_band_poc_mentions",
    "poc_phone_numbers",
    "poc_alert_wa_groups",
  ]);

  // Both empty: both named.
  const [both] = rowProblems("lightning", { enable_red_band_poc_mentions: true }, label);
  assert.match(both.message, /POC phone numbers and POC mention groups/);

  // Satisfied, and off, are both silent.
  assert.deepEqual(
    rowProblems("lightning", { enable_red_band_poc_mentions: true, poc_phone_numbers: "65", poc_alert_wa_groups: "g" }, label),
    [],
  );
  assert.deepEqual(rowProblems("lightning", { enable_red_band_poc_mentions: false }, label), []);
});

test("whitespace is not content — a list of spaces is still empty", () => {
  // btrim(coalesce(x,'')) <> '' is what Postgres checks, so " " passes a
  // naive truthiness test here and is then rejected there.
  const [problem] = rowProblems(
    "lightning",
    { enable_red_band_poc_mentions: true, poc_phone_numbers: "65", poc_alert_wa_groups: "   " },
    label,
  );
  assert.ok(problem, "a whitespace-only list must count as empty");
});

test("a window needs both ends, and never the same instant", () => {
  const half = rowProblems("issueChaser", { severity_p1_window_start: "0800" }, label);
  assert.match(half[0]?.message ?? "", /both ends or neither/);
  const same = rowProblems(
    "issueChaser",
    { severity_p1_window_start: "0800", severity_p1_window_end: "0800" },
    label,
  );
  assert.match(same[0]?.message ?? "", /same time/);
  assert.deepEqual(
    rowProblems("issueChaser", { severity_p1_window_start: "0800", severity_p1_window_end: "1900" }, label),
    [],
  );
  // Neither end set is the normal case and must be silent.
  assert.deepEqual(rowProblems("issueChaser", {}, label), []);
});

test("the remedy differs between editing a row and creating one", () => {
  const row = { enabled: false, daily_safety_summary_enabled: true, whatsapp_group_ids: "g" };
  const editing = rowProblems("issueChaser", row, label, "editing")[0]?.message ?? "";
  const creating = rowProblems("issueChaser", row, label, "creating")[0]?.message ?? "";
  // Same rule, both times.
  assert.match(editing, /only allows it on an enabled project/);
  assert.match(creating, /only allows it on an enabled project/);
  // Different advice: you cannot enable a row that does not exist yet.
  assert.match(editing, /turn Project enabled on in the same save/);
  assert.match(creating, /always created disabled/);
  assert.doesNotMatch(creating, /in the same save/);
});

test("a violation that was already stored does not block an unrelated edit", () => {
  // Postgres enforces these on write, so a stored row satisfies them — except
  // where a constraint was added to a table that already had rows, which has
  // happened here more than once. Blocking an edit on a violation the
  // operator did not cause makes the editor useless for exactly the rows that
  // most need editing.
  const broken = { enable_red_band_poc_mentions: true, poc_alert_wa_groups: "", poc_phone_numbers: "" };
  assert.equal(rowProblems("lightning", broken, label).length, 1, "it is a violation");
  assert.deepEqual(
    newProblems("lightning", broken, { ...broken, site_address: "somewhere else" }, label),
    [],
    "but not one this edit caused",
  );
  // Causing a NEW one still blocks.
  const fine = { enable_red_band_poc_mentions: false };
  assert.equal(
    newProblems("lightning", fine, { ...fine, enable_red_band_poc_mentions: true }, label).length,
    1,
  );
});

test("a constraint Postgres quotes back resolves to the rule that explains it", () => {
  const rule = explainConstraint(
    "lightning",
    'new row for relation "lightning_project_configs" violates check constraint "lightning_red_poc_mentions_check"',
  );
  assert.equal(rule?.constraint, "lightning_red_poc_mentions_check");
  assert.equal(explainConstraint("lightning", "some unrelated failure"), null);
  // Wrong service, right name: still null, because the columns would be wrong.
  assert.equal(explainConstraint("haze", 'violates check constraint "lightning_red_poc_mentions_check"'), null);
});

test("every rule is well formed", () => {
  const seen = new Set<string>();
  for (const service of SERVICE_KEYS) {
    for (const rule of ROW_RULES[service] ?? []) {
      assert.ok(rule.columns.length, `${rule.constraint} points at no field`);
      assert.ok(!seen.has(rule.constraint), `${rule.constraint} is declared twice`);
      seen.add(rule.constraint);
      // An empty row must not trip a rule: every one of these is conditional
      // on something being switched on or filled in, and a rule that fires on
      // a blank row would block every new project.
      assert.deepEqual(
        rowProblems(service, {}, label).filter((problem) => problem.constraint === rule.constraint),
        [],
        `${rule.constraint} fires on an empty row`,
      );
    }
  }
});
