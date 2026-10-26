import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { dueHealthWindow, healthSummary, healthSummaryKey } from "../lib/health-notifications";
import { SERVICE_KEYS, SERVICES } from "../lib/services";

const start = new Date("2026-10-22T16:00:00Z"); // 23 Oct 00:00 SGT
const end = new Date("2026-10-23T00:00:00Z"); // 23 Oct 08:00 SGT
const empty = { windowStart: start, windowEnd: end, health: [], strips: {}, faults: {}, notices: [] };

test("only the first fifteen minutes of 00:00, 08:00 and 16:00 SGT are due", () => {
  assert.deepEqual(dueHealthWindow(new Date("2026-10-22T16:05:00Z")), {
    start: new Date("2026-10-22T08:00:00Z"), end: new Date("2026-10-22T16:00:00Z"),
  });
  assert.deepEqual(dueHealthWindow(new Date("2026-10-23T00:14:59Z")), { start, end });
  assert.deepEqual(dueHealthWindow(new Date("2026-10-23T08:00:00Z")), {
    start: new Date("2026-10-23T00:00:00Z"), end: new Date("2026-10-23T08:00:00Z"),
  });
  assert.equal(dueHealthWindow(new Date("2026-10-23T00:15:00Z")), null);
  assert.equal(dueHealthWindow(new Date("2026-10-23T02:00:00Z")), null);
});

test("one healthy digest includes every service and the slot has one stable claim key", () => {
  const summary = healthSummary(empty);
  assert.match(summary.message, /✅ No red or orange issues reported/);
  for (const service of SERVICE_KEYS) {
    assert.ok(summary.message.includes(`*${SERVICES[service].label}*`));
  }
  assert.equal(summary.issueCount, 0);
  assert.equal(summary.key, healthSummary({ ...empty, health: [] }).key);
  assert.equal(summary.key, healthSummaryKey(end));
  assert.notEqual(summary.key, healthSummary({ ...empty, windowEnd: new Date(end.getTime() + 8 * 3_600_000) }).key);
});

test("the previous eight hours include old and new errors but collapse repeated kinds", () => {
  const summary = healthSummary({
    ...empty,
    strips: {
      '["noise","TJR"]': [
        { at: "2026-10-22T15:59:59Z", colour: "red", status: "failed_source", kind: "scrape", log: ["outside window"] },
        { at: "2026-10-22T17:00:00Z", colour: "red", status: "failed_source", kind: "scrape", log: ["API unavailable"] },
        { at: "2026-10-22T18:00:00Z", colour: "red", status: "failed_source", kind: "scrape", log: ["API unavailable"] },
        { at: "2026-10-22T19:00:00Z", colour: "amber", status: "completed_with_errors", kind: "send", log: ["one group rejected"] },
        { at: "2026-10-22T20:00:00Z", colour: "stale", status: "completed_with_issues", kind: "scrape", log: ["old reading"] },
        { at: "2026-10-23T00:00:00Z", colour: "red", status: "failed_source", kind: "scrape", log: ["next window"] },
      ],
      '["noise","CCCC"]': [
        { at: "2026-10-22T21:00:00Z", colour: "red", status: "failed_source", kind: "scrape", log: ["API unavailable"] },
      ],
      '["haze","HLD"]': [
        { at: "2026-10-22T22:00:00Z", colour: "red", status: "failed_fetch", log: [] },
      ],
    },
  });
  assert.equal(summary.issueCount, 3);
  assert.equal(summary.message.match(/API unavailable/g)?.length, 1);
  assert.match(summary.message, /🔴 CCCC, TJR — scrape · failed_source: API unavailable \(×3\)/);
  assert.match(summary.message, /🟠 TJR — send · completed_with_errors: one group rejected/);
  assert.match(summary.message, /🔴 HLD — failed_fetch: No reason recorded/);
  assert.doesNotMatch(summary.message, /outside window|next window|old reading/);
  assert.ok(summary.message.indexOf("🔴 CCCC") < summary.message.indexOf("🟠 TJR"));
});

test("current red and amber findings appear beside historical errors", () => {
  const summary = healthSummary({
    ...empty,
    health: [{ service: "vibration", projectCode: "V1", tone: "warn", label: "Data: could not read table", newestReceivedAt: null, sourceEventAt: null }],
    faults: { '["ailytics","A1"]': "listener queue missing" },
    notices: [{ id: "tick", colour: "red", label: "tick stopped", detail: null }],
  });
  assert.match(summary.message, /🟠 V1 — Current reading issue: Data: could not read table/);
  assert.match(summary.message, /🔴 A1 — Current configuration issue: listener queue missing/);
  assert.match(summary.message, /🔴 Lightning tick — Current service issue: tick stopped/);
});

test("the notify route keeps one claim and one listener send per due slot", async () => {
  const route = await readFile(resolve("app/api/data-health/notify/route.ts"), "utf8");
  assert.match(route, /dueHealthWindow\(new Date\(\)\)/);
  assert.ok(route.indexOf("alreadyClaimed(healthSummaryKey(window.end), config)") < route.indexOf("listNotificationProcessWindow(window.start)"));
  assert.match(route, /listNotificationEstateHealth\(\)/);
  assert.match(route, /listNotificationProcessWindow\(window\.start\)/);
  assert.match(route, /claim\(summary\.key, config\)/);
  assert.match(route, /send\(summary\.message, config\)/);
  assert.doesNotMatch(route, /for \(const alert of alerts\)/);
});
