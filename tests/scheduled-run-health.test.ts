import assert from "node:assert/strict";
import test from "node:test";

import { completedHazeHourlySlots, missingHazeHourlyEntries } from "../lib/scheduled-run-health";
import { summarise } from "../lib/health-board";
import { formatHealthCurrentIssues } from "../lib/health-report";

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
