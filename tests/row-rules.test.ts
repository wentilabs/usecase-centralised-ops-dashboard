import assert from "node:assert/strict";
import test from "node:test";

import { ROW_RULES, explainConstraint, newProblems, rowProblems } from "../lib/row-rules";
import { SERVICE_KEYS } from "../lib/services";
import { onboardingFor } from "../lib/onboarding";

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

test("a constraint dropped on request blocks nothing, but still explains itself", () => {
  // issue_chaser_feature_requires_enabled_check only allowed a feature flag on
  // an enabled project, which meant turning a project off required turning
  // five flags off first. The service never needed it — `isFeatureEnabled` is
  // `config.enabled && config[column]`, so a disabled project sends nothing
  // whatever the flags say — and it was dropped on 11 Sep 2026.
  const row = { enabled: false, daily_safety_summary_enabled: true, whatsapp_group_ids: "g" };
  assert.deepEqual(rowProblems("issueChaser", row, label), [], "nothing is blocked");
  assert.deepEqual(rowProblems("issueChaser", row, label, "creating"), []);

  // The name is still declared, so a database that has not had the DROP run
  // against it gets a sentence rather than a constraint name — and the
  // sentence is the DROP.
  const rule = explainConstraint(
    "issueChaser",
    'violates check constraint "issue_chaser_feature_requires_enabled_check"',
  );
  assert.ok(rule, "the constraint must still resolve");
  assert.equal(rule!.check(row, label), null, "and must not pre-empt");
  assert.match(rule!.explain ?? "", /drop constraint if exists/);
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

test("a constraint that has been dropped upstream is not mirrored", () => {
  // wbgt_project_configs_water_parade_single_group forbade a comma in the
  // Water Parade group. migrate_water_parade_multiple_groups.sql drops it, and
  // the service now sends one reminder per group. Probed against the live
  // database on the wbgt TEST fixture: a two-group value is accepted.
  //
  // A mirror blocking a save the database allows is the one failure it must
  // not have — worse than no mirror, because there is no way past it.
  assert.deepEqual(
    rowProblems("wbgt", { water_parade_outbound_group_id: "1@g.us,2@g.us" }, label),
    [],
  );
  assert.equal(
    (ROW_RULES.wbgt ?? []).some((rule) => rule.constraint.includes("water_parade_single_group")),
    false,
  );
});

test("every rule is well formed", () => {
  const seen = new Set<string>();
  for (const service of SERVICE_KEYS) {
    for (const rule of ROW_RULES[service] ?? []) {
      // A translation-only rule points at no field on purpose: it blocks
      // nothing, so there is nothing to highlight.
      if (rule.check({}, label) !== null || rule.columns.length) {
        assert.ok(rule.columns.length, `${rule.constraint} points at no field`);
      } else {
        assert.ok(rule.explain, `${rule.constraint} neither checks nor explains`);
      }
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

test("requiresEnabled, where a service declares it, matches its row rule", () => {
  // Two declarations of one constraint drift. issue-chaser's pair did: the
  // Novade flags joined issue_chaser_feature_requires_enabled_check and only
  // the rule was updated, so a template carrying novade_name_sync_enabled
  // produced a row the dialog called ready and Postgres refused. The
  // constraint has since been dropped and issue-chaser declares neither, but
  // the guard stays for the next service that needs one.
  for (const service of SERVICE_KEYS) {
    const definition = onboardingFor(service);
    const declared = definition?.requiresEnabled ?? [];
    if (!declared.length) continue;
    const rule = (ROW_RULES[service] ?? []).find((entry) => entry.constraint.includes("requires_enabled"));
    assert.ok(rule, `${service} declares requiresEnabled with no matching row rule`);
    assert.deepEqual(
      [...declared].sort(),
      rule!.columns.filter((column) => column !== "enabled").sort(),
      `${service}: the two lists have drifted`,
    );
  }
  assert.equal(
    onboardingFor("issueChaser")?.requiresEnabled,
    undefined,
    "issue-chaser's constraint was dropped, so nothing should still declare it",
  );
});

test("a schedule the service would refuse is caught before it is saved", () => {
  // issue-chaser's ece9060 moved the three report cadences into text columns.
  // Postgres has no opinion on them — `08:00` and `0800,-1` both store fine —
  // and the service refuses the WHOLE schedule over one bad entry, so the
  // report stops and the only trace is an `invalid_project_schedule` log line.
  const at = (value: string) =>
    rowProblems("issueChaser", { same_day_open_snapshot_schedule: value }, (c) =>
      c === "same_day_open_snapshot_schedule" ? "Snapshot schedule" : c,
    );

  assert.deepEqual(at("0900,0;2100,0"), [], "the migrated default is valid");
  assert.deepEqual(at("0800,4"), []);
  assert.deepEqual(at(""), [], "blank is not an error — it means no scheduled run");
  assert.deepEqual(at("  0900 , 1 ; 2100 , 1 "), [], "spacing is tolerated, as the service tolerates it");

  // A time written the way a person writes one.
  const colon = at("09:00,0");
  assert.match(colon[0]?.message ?? "", /"09:00,0" is not a valid entry/);
  assert.match(colon[0]?.message ?? "", /HH00,days/);
  assert.deepEqual(colon[0]?.columns, ["same_day_open_snapshot_schedule"]);

  // Minutes that are not 00, an hour that does not exist, a missing lookback,
  // and a negative one — all refused by `lib/hourly-schedule.js`.
  for (const value of ["0830,0", "2400,0", "0900", "0900,-1"]) {
    assert.equal(at(value).length, 1, `${value} must be refused`);
  }

  // One bad entry among good ones is still fatal, and only the bad one is named.
  const mixed = at("0900,0;2500,1;2100,0");
  assert.match(mixed[0]?.message ?? "", /"2500,1"/);
  assert.doesNotMatch(mixed[0]?.message ?? "", /"0900,0"/);

  // All three columns are covered, not just the one that was easy to reach.
  for (const column of [
    "daily_safety_summary_schedule",
    "daily_safety_company_summary_schedule",
  ]) {
    assert.equal(rowProblems("issueChaser", { [column]: "nope" }, label).length, 1, `${column} is unchecked`);
  }
});

test("the third summary is covered by both issue-chaser rules", () => {
  // 1b7975c added a ChatGroup breakdown as a third route with its own flag and
  // its own schedule, and added the flag to
  // issue_chaser_summary_destination_check. A rule that still knows two
  // summaries lets the third save with nowhere to send and a schedule the
  // service cannot parse.
  const chat = (row: Record<string, unknown>) => rowProblems("issueChaser", row, label);

  // Destination: on with no destination at all is refused.
  assert.equal(chat({ daily_safety_chatgroup_summary_enabled: true }).length, 1);
  // Either destination satisfies it, as for the other two.
  assert.deepEqual(chat({ daily_safety_chatgroup_summary_enabled: true, whatsapp_group_ids: "g@g.us" }), []);
  assert.deepEqual(
    chat({ daily_safety_chatgroup_summary_enabled: true, safety_summary_whatsapp_group_ids: "g@g.us" }),
    [],
  );

  // Schedule: same format as the other three, same refusal.
  const bad = chat({ daily_safety_chatgroup_summary_schedule: "8am" });
  assert.equal(bad.length, 1, "a malformed chat group schedule must be caught");
  assert.match(bad[0].message, /"8am" is not a valid entry/);
  assert.deepEqual(chat({ daily_safety_chatgroup_summary_schedule: "0800,4" }), []);

  // All four schedule columns have a rule, so none is checked by accident.
  const schedules = (ROW_RULES.issueChaser ?? []).filter((r) => r.constraint.endsWith("_schedule_format"));
  assert.equal(schedules.length, 4, `expected four schedule rules, found ${schedules.length}`);
});

test("each summary's own destination satisfies the constraint on its own", () => {
  // The destination check became per-style: each enabled summary needs its own
  // field, the shared one, or the legacy fallback. A rule still asking only
  // about the shared field would refuse a project that routes the company
  // summary to its own group and leaves the shared one blank — a save Postgres
  // accepts, which is the one failure a mirror must not have.
  const at = (row: Record<string, unknown>) => rowProblems("issueChaser", row, label);

  for (const [flag, own] of [
    ["daily_safety_summary_enabled", "daily_safety_summary_whatsapp_group_ids"],
    ["daily_safety_company_summary_enabled", "daily_safety_company_summary_whatsapp_group_ids"],
    ["daily_safety_chatgroup_summary_enabled", "daily_safety_chatgroup_summary_whatsapp_group_ids"],
  ] as const) {
    assert.equal(at({ [flag]: true }).length, 1, `${flag} with no destination must be refused`);
    assert.deepEqual(at({ [flag]: true, [own]: "g@g.us" }), [], `${own} alone must satisfy it`);
    assert.deepEqual(at({ [flag]: true, safety_summary_whatsapp_group_ids: "g@g.us" }), [], "shared covers it");
    assert.deepEqual(at({ [flag]: true, whatsapp_group_ids: "g@g.us" }), [], "legacy covers it");
  }

  // One summary's field does not cover another's.
  const crossed = at({
    daily_safety_summary_enabled: true,
    daily_safety_company_summary_enabled: true,
    daily_safety_company_summary_whatsapp_group_ids: "g@g.us",
  });
  assert.equal(crossed.length, 1);
  // Named by label, as the editor shows it — "Daily safety summary" is the
  // plain one; the company flag has no entry in LABELS and stays raw.
  assert.match(crossed[0].message, /Daily safety summary needs somewhere to go/);
  assert.doesNotMatch(crossed[0].message, /company/);
});

test("the Water Parade summary hour is an hour, not a time", () => {
  // migrate_water_parade_daily_summary.sql bounds it 0-23. NOT NULL with a
  // default of 18, so the only way to break it is to type — and an hour field
  // is exactly where someone writes 1800 meaning 18:00. Postgres would answer
  // with the constraint name; this answers with the rule.
  const label = (column: string) => column;
  const problems = newProblems(
    "wbgt",
    { water_parade_daily_summary_hour: 18 },
    { water_parade_daily_summary_hour: 1800 },
    label,
  );
  assert.equal(problems.length, 1, "1800 must be refused before the save");
  assert.match(problems[0].message, /0 to 23/);
  assert.match(problems[0].message, /18 means 18:00/);

  // The ends of the range are legal, and so is leaving it alone.
  for (const hour of [0, 18, 23]) {
    assert.equal(
      newProblems("wbgt", {}, { water_parade_daily_summary_hour: hour }, label).length,
      0,
      `${hour} is a legal hour`,
    );
  }
});
