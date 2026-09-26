import assert from "node:assert/strict";
import test from "node:test";

import { activityFor, activityLabel, activeHoursFor, sgtHour } from "../lib/data-health-activity";
import { assessIngestionHealth, healthTarget } from "../lib/data-health";
import type { ProjectConfigRow } from "../lib/services";

/** 2026-09-26T12:00Z is 20:00 in Singapore. */
const EVENING = new Date("2026-09-26T12:00:00.000Z");
/** 2026-09-26T02:00Z is 10:00 in Singapore — inside an ordinary site day. */
const MIDMORNING = new Date("2026-09-26T02:00:00.000Z");

const row = (over: Record<string, unknown>): ProjectConfigRow =>
  ({ project_code: "TJR", enabled: true, whatsapp_group_id: "1@g.us", ...over }) as unknown as ProjectConfigRow;

test("Singapore's hour is read without a timezone library, because it never shifts", () => {
  assert.equal(sgtHour(new Date("2026-09-26T12:00:00.000Z")), 20);
  assert.equal(sgtHour(new Date("2026-09-26T16:00:00.000Z")), 0, "midnight SGT is 16:00 UTC the day before");
  assert.equal(sgtHour(new Date("2026-09-26T15:59:00.000Z")), 23);
});

test("a site outside its cadence hours is idle, not unhealthy", () => {
  // The whole point. A project configured 08:00-18:00 stops at 18:00 exactly as
  // asked, and calling that "no recent data" every evening is how a colour
  // stops being read — the jobs' own runs say
  // skipped_outside_project_cadence_window for these.
  const site = row({ site_hours_start: 8, site_hours_end: 18 });
  assert.equal(activityFor("wbgt", site, EVENING).state, "idle");
  assert.equal(activityFor("wbgt", site, MIDMORNING).state, "active");

  assert.equal(activityLabel({ state: "idle", activeHours: [8, 9] }), "Data: idle — outside cadence hours");
  assert.equal(activityLabel({ state: "dormant" }), "Data: idle — no cadences on");
  assert.equal(activityLabel({ state: "disabled" }), "Data: idle — project disabled");
  // An active project has nothing to excuse, so it carries no idle label.
  assert.equal(activityLabel({ state: "active", cadence: "hourly report", activeHours: [10], toleranceMs: 1 }), null);
});

test("a project nothing asks of is dormant, and a disabled one outranks its cadences", () => {
  assert.equal(activityFor("noise", row({}), MIDMORNING).state, "dormant", "no cadence flag is on");
  assert.equal(
    activityFor("noise", row({ enabled: false, enable_hourly: true }), MIDMORNING).state,
    "disabled",
  );
});

test("the tolerated gap comes from the project's own cadence, not a fixed budget", () => {
  // A cadence running every hour of a site day tolerates an hour (plus an
  // hour's grace, because a job that fires at :05 has not failed at :04).
  const hourly = activityFor("wbgt", row({ site_hours_start: 8, site_hours_end: 21 }), EVENING);
  assert.equal(hourly.state, "active");
  assert.equal(hourly.state === "active" && hourly.toleranceMs, 2 * 60 * 60 * 1000);

  // Hours wrap across midnight rather than going negative, and a project with a
  // single active hour tolerates a day — judging that hourly would call a
  // healthy once-a-day report broken twenty-three times out of twenty-four.
  const oneHour = activeHoursFor("wbgt", row({ site_hours_start: 20, site_hours_end: 20 }));
  assert.deepEqual(oneHour.hours, [20]);
  const single = activityFor("wbgt", row({ site_hours_start: 20, site_hours_end: 20 }), EVENING);
  assert.equal(single.state === "active" && single.toleranceMs, 25 * 60 * 60 * 1000);

  /**
   * The first active hour of the day looks back to the LAST one, yesterday.
   *
   * A site running 08:00–10:00, asked at 08:00: the previous occurrence was
   * 10:00 yesterday, twenty-two hours ago, so the overnight silence is
   * expected. Subtracting without wrapping would give eight hours and report a
   * project that has just started its day as already behind.
   */
  const dayStart = new Date("2026-09-26T00:00:00.000Z"); // 08:00 SGT
  const firstHour = activityFor("wbgt", row({ site_hours_start: 8, site_hours_end: 10 }), dayStart);
  assert.equal(firstHour.state, "active");
  assert.equal(firstHour.state === "active" && firstHour.activeHours[0], 8);
  assert.equal(firstHour.state === "active" && firstHour.toleranceMs, 23 * 60 * 60 * 1000);
});

test("an idle verdict ignores the evidence entirely", () => {
  const target = healthTarget("wbgt", "TJR")!;
  const stale = { kind: "row" as const, createdAt: "2020-01-01T00:00:00.000Z", sourceEventAt: null };

  // Years stale, and still not a fault: nothing was expected of it.
  const idle = assessIngestionHealth(target, stale as never, EVENING, { state: "idle", activeHours: [8, 9] });
  assert.equal(idle.tone, "neutral");
  assert.match(idle.label, /idle/);

  // An empty table is likewise not a fault for a dormant project — checked
  // before the evidence, so "no data received yet" cannot fire on a project
  // nothing asks of.
  const dormant = assessIngestionHealth(target, { kind: "empty" }, EVENING, { state: "dormant" });
  assert.equal(dormant.tone, "neutral");
  assert.match(dormant.label, /idle/);
});

test("inside the window, silence is still reported", () => {
  const target = healthTarget("wbgt", "TJR")!;
  const active = { state: "active" as const, cadence: "hourly report", activeHours: [8, 9, 10], toleranceMs: 2 * 60 * 60 * 1000 };
  const at = (iso: string) => ({ kind: "row" as const, createdAt: iso, sourceEventAt: null });

  // Fresh within the tolerated gap.
  assert.equal(assessIngestionHealth(target, at("2026-09-26T01:30:00.000Z") as never, MIDMORNING, active).tone, "good");
  // Past it — the project should have produced and did not.
  assert.equal(assessIngestionHealth(target, at("2026-09-25T23:30:00.000Z") as never, MIDMORNING, active).tone, "warn");
  // Twice past it.
  assert.equal(assessIngestionHealth(target, at("2026-09-25T20:00:00.000Z") as never, MIDMORNING, active).tone, "danger");
  // And an active project with nothing at all is a real fault.
  assert.equal(assessIngestionHealth(target, { kind: "empty" }, MIDMORNING, active).tone, "danger");
});

test("a long cadence is judged by its own gap, not by the fixed budget", () => {
  /**
   * The case the fixed budgets got wrong, and the reason they are replaced.
   *
   * `warningAfterMs` is 1h and `criticalAfterMs` 4h for every target, whatever
   * the project does. A report that runs once a day is legitimately five hours
   * stale for most of the day, and the flat budget called that "no recent
   * data" — so the card was red on a project behaving exactly as configured.
   */
  const target = healthTarget("wbgt", "TJR")!;
  const fiveHoursOld = { kind: "row" as const, createdAt: "2026-09-25T21:00:00.000Z", sourceEventAt: null };
  const dailyReport = {
    state: "active" as const,
    cadence: "daily report",
    activeHours: [10],
    toleranceMs: 25 * 60 * 60 * 1000,
  };

  assert.equal(assessIngestionHealth(target, fiveHoursOld as never, MIDMORNING, dailyReport).tone, "good");
  // Same evidence, same moment, judged by the fixed budget instead.
  assert.equal(assessIngestionHealth(target, fiveHoursOld as never, MIDMORNING).tone, "danger");
  assert.ok(dailyReport.toleranceMs > target.criticalAfterMs, "the gap this cadence allows exceeds the flat budget");
});

test("without an activity the old fixed budgets still apply", () => {
  // Additive: a caller that cannot say what the project should be doing gets
  // exactly the behaviour it had before.
  const target = healthTarget("wbgt", "TJR")!;
  const stale = { kind: "row" as const, createdAt: "2026-09-26T06:00:00.000Z", sourceEventAt: null };
  assert.equal(assessIngestionHealth(target, stale as never, EVENING).tone, "danger");
});
