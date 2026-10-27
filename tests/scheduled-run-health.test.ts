import assert from "node:assert/strict";
import test from "node:test";

import { completedHazeHourlySlots, missingFrequentRunEntries, missingHazeHourlyEntries } from "../lib/scheduled-run-health";
import { summarise } from "../lib/health-board";
import { formatHealthCurrentIssues } from "../lib/health-report";
import { completedNoiseTicks, missingNoiseScheduleEntries, NOISE_SCHEDULES } from "../lib/noise-schedule-health";
import { completedSubconTicks, missingSubconScheduleEntries, SUBCON_SCHEDULES } from "../lib/subcon-schedule-health";

test("two completed haze hours with no project run become one current issue", () => {
  const evidence = {
    checkedAt: "2026-10-26T07:16:00.000Z", // 15:16 SGT
    runs: [{ projectCode: "CRP", at: "2026-10-26T07:02:00.000Z" }],
  };
  assert.deepEqual(completedHazeHourlySlots(evidence.checkedAt), [
    "2026-10-26T06:00:00.000Z", "2026-10-26T07:00:00.000Z",
  ]);
  const entries = missingHazeHourlyEntries([
    { project_code: "IR2", enabled: true, wa_group_ids: "group-a", updated_at: "2026-10-26T05:51:00.000Z" },
    { project_code: "CRP", enabled: true, wa_group_ids: "group-b" },
    { project_code: "OFF", enabled: false, wa_group_ids: "group-c" },
  ], evidence);
  assert.deepEqual(entries.map((entry) => entry.projectCode), ["IR2"]);
  assert.equal(entries[0]?.colour, "red");
  const summary = summarise(entries);
  assert.equal(summary.red, 1);
  assert.match(formatHealthCurrentIssues(summary.incidents, []), /Scheduled hourly run missing/);
});

test("a recorded skip, recent config edit, unreadable log, and unfinished slot do not alarm", () => {
  const rows = [{ project_code: "IR2", enabled: true, wa_group_ids: "group-a" }];
  assert.deepEqual(missingHazeHourlyEntries(rows, null), []);
  assert.deepEqual(missingHazeHourlyEntries(rows, {
    checkedAt: "2026-10-26T07:14:00.000Z",
    runs: [{ projectCode: "IR2", at: "2026-10-26T06:01:00.000Z" }],
  }), []);
  assert.deepEqual(missingHazeHourlyEntries(rows, {
    checkedAt: "2026-10-26T07:16:00.000Z",
    runs: [{ projectCode: "IR2", at: "2026-10-26T06:01:00.000Z" }],
  }), []);
  assert.deepEqual(missingHazeHourlyEntries([{ ...rows[0], updated_at: "2026-10-26T06:30:00.000Z" }], {
    checkedAt: "2026-10-26T07:16:00.000Z", runs: [],
  }), []);
  assert.deepEqual(missingHazeHourlyEntries([{ ...rows[0], wa_group_ids: " " }], {
    checkedAt: "2026-10-26T07:16:00.000Z", runs: [],
  }), []);
});

test("a previously observed frequent service job missing from two complete hours becomes one current issue", () => {
  const entries = missingFrequentRunEntries({
    wbgt: [{ project_code: "IR2", enabled: true, updated_at: "2026-10-25T00:00:00.000Z" }],
  }, {
    checkedAt: "2026-10-26T07:16:00.000Z",
    sources: [{ service: "wbgt", job: "WBGT scrape", state: "ready", latestAt: "2026-10-26T05:59:00.000Z" }],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.scope, "service");
  assert.equal(entries[0]?.colour, "red");
});

test("frequent run inference requires readable recent baseline, active config, and two missed hours", () => {
  const evidence = {
    checkedAt: "2026-10-26T07:16:00.000Z",
    sources: [
      { service: "wbgt" as const, job: "WBGT scrape", state: "ready" as const, latestAt: "2026-10-26T06:00:00.000Z" },
      { service: "ailytics" as const, job: "Ailytics hourly summary", state: "no_history" as const, latestAt: null },
      { service: "issueChaser" as const, job: "Issue Chaser severity check", state: "unavailable" as const, latestAt: null },
      { service: "vibration" as const, job: "Vibration scrape", state: "ready" as const, latestAt: "2026-10-26T05:59:00.000Z" },
    ],
  };
  assert.deepEqual(missingFrequentRunEntries({ wbgt: [{ enabled: true }], vibration: [{ enabled: false }] }, evidence), []);
  assert.deepEqual(missingFrequentRunEntries({ vibration: [{ enabled: true, updated_at: "2026-10-26T06:30:00.000Z" }] }, evidence), []);
  assert.deepEqual(missingFrequentRunEntries({}, null), []);
});

test("Noise screenshot schedules use UTC and cover all sixteen scheduled routes", () => {
  assert.equal(NOISE_SCHEDULES.length, 16);
  const scrape = NOISE_SCHEDULES.find((schedule) => schedule.route === "/api/scrape-noiselynx")!;
  assert.deepEqual(completedNoiseTicks("2026-10-27T10:25:00.000Z", scrape), [
    "2026-10-27T10:02:00.000Z", "2026-10-27T10:07:00.000Z",
  ]);
  const sunday = NOISE_SCHEDULES.find((schedule) => schedule.route === "/api/noise-limit-refresh")!;
  assert.deepEqual(completedNoiseTicks("2026-10-27T10:25:00.000Z", sunday), [
    "2026-10-18T02:00:00.000Z", "2026-10-25T02:00:00.000Z",
  ]);
  const monthly = NOISE_SCHEDULES.find((schedule) => schedule.route === "/api/noise-monthly-report")!;
  assert.deepEqual(completedNoiseTicks("2026-10-27T10:25:00.000Z", monthly), [
    "2026-09-01T04:45:00.000Z", "2026-10-01T04:45:00.000Z",
  ]);
});

test("Noise needs a baseline and two completed due times before a missed route is flagged", () => {
  const route = "/api/scrape-noiselynx";
  assert.deepEqual(missingNoiseScheduleEntries(null), []);
  assert.deepEqual(missingNoiseScheduleEntries({ checkedAt: "2026-10-27T10:25:00Z", state: "unavailable", routes: [{ route, lastSeenAt: "2026-10-27T10:01:00Z" }] }), []);
  assert.deepEqual(missingNoiseScheduleEntries({ checkedAt: "2026-10-27T10:25:00Z", state: "ready", routes: [] }), []);
  assert.deepEqual(missingNoiseScheduleEntries({ checkedAt: "2026-10-27T10:25:00Z", state: "ready", routes: [{ route, lastSeenAt: "2026-10-27T10:02:00Z" }] }), []);
  const entries = missingNoiseScheduleEntries({ checkedAt: "2026-10-27T10:25:00Z", state: "ready", routes: [{ route, lastSeenAt: "2026-10-27T10:01:00Z" }] });
  assert.deepEqual(entries.map((entry) => entry.projectCode), [route]);
  assert.equal(entries[0]?.scope, "service");
  assert.equal(entries[0]?.colour, "red");
});

test("Subcon's two manpower rules have independent UTC due times", () => {
  assert.equal(SUBCON_SCHEDULES.length, 6);
  const early = SUBCON_SCHEDULES.find((schedule) => schedule.key === "manpower-summary-0205")!;
  const late = SUBCON_SCHEDULES.find((schedule) => schedule.key === "manpower-summary-0805")!;
  assert.deepEqual(completedSubconTicks("2026-10-27T08:21:00Z", early), [
    "2026-10-26T02:05:00.000Z", "2026-10-27T02:05:00.000Z",
  ]);
  assert.deepEqual(completedSubconTicks("2026-10-27T08:21:00Z", late), [
    "2026-10-26T08:05:00.000Z", "2026-10-27T08:05:00.000Z",
  ]);
  const weekly = SUBCON_SCHEDULES.find((schedule) => schedule.key === "housekeeping-photos-saturday-2000")!;
  assert.deepEqual(completedSubconTicks("2026-10-27T08:21:00Z", weekly), [
    "2026-10-17T20:00:00.000Z", "2026-10-24T20:00:00.000Z",
  ]);
});

test("Subcon only flags a rule with a baseline older than two completed runs", () => {
  const checkedAt = "2026-10-27T08:21:00Z";
  const early = { scheduleKey: "manpower-summary-0205", lastStartedAt: "2026-10-25T02:05:00Z" };
  const late = { scheduleKey: "manpower-summary-0805", lastStartedAt: "2026-10-27T08:05:00Z" };
  assert.deepEqual(missingSubconScheduleEntries(null), []);
  assert.deepEqual(missingSubconScheduleEntries({ checkedAt, state: "unavailable", schedules: [early] }), []);
  assert.deepEqual(missingSubconScheduleEntries({ checkedAt, state: "ready", schedules: [] }), []);
  const entries = missingSubconScheduleEntries({ checkedAt, state: "ready", schedules: [early, late] });
  assert.deepEqual(entries.map((entry) => entry.projectCode), ["manpower-summary-0205"]);
  assert.equal(entries[0]?.scope, "service");
  assert.equal(entries[0]?.colour, "red");
});
