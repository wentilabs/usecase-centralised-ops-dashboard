import assert from "node:assert/strict";
import test from "node:test";

import { formatHealthErrorReport } from "../lib/health-report";
import type { Bar } from "../lib/health-timeline";

const bar = (colour: Bar["colour"], status: string, at: string, log: string[]): Bar => ({
  colour,
  status,
  at,
  log,
});

test("copy report includes red and orange process errors across projects, newest first", () => {
  const report = formatHealthErrorReport({
    '["noise","TJR"]': [
      bar("green", "completed", "2026-10-20T10:00:00Z", []),
      bar("amber", "completed_with_meter_issues", "2026-10-20T10:05:00Z", ["Unable to select location TJR NM01"]),
      bar("red", "failed", "2026-10-20T10:10:00Z", ["feed unavailable"]),
      bar("stale", "completed_with_meter_issues", "2026-10-20T10:15:00Z", ["reading 70 minutes old"]),
    ],
    '["wbgt","C991"]': [bar("amber", "completed_with_issues", "2026-10-20T10:20:00Z", ["Missing configured sensors: WBGT C991 (Manual)"])],
  });

  assert.match(report, /Noise · TJR/);
  assert.match(report, /WBGT · C991/);
  assert.ok(report.indexOf("20 Oct 2026, 18:10 SGT") < report.indexOf("20 Oct 2026, 18:05 SGT"));
  assert.doesNotMatch(report, /reading 70 minutes old|18:00 SGT/);
});

test("copy report gives a useful empty message", () => {
  assert.match(formatHealthErrorReport({}), /No red or orange process errors/);
});
