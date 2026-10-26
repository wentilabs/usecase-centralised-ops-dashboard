import assert from "node:assert/strict";
import test from "node:test";

import { executeHealthNotification, type HealthNotificationDependencies } from "../lib/health-notification-flow";
import { currentHealthWindow, dueHealthWindow, healthSummary, healthSummaryKey, parseHealthNotifyOptions } from "../lib/health-notifications";
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
  assert.deepEqual(currentHealthWindow(new Date("2026-10-23T02:00:00Z")), {
    start: new Date("2026-10-22T18:00:00Z"), end: new Date("2026-10-23T02:00:00Z"),
  });
});

test("manual options require explicit booleans and cannot combine preview with sending", () => {
  assert.deepEqual(parseHealthNotifyOptions({}), { dryRun: false, force: false });
  assert.deepEqual(parseHealthNotifyOptions({ dryRun: true }), { dryRun: true, force: false });
  assert.deepEqual(parseHealthNotifyOptions({ force: true }), { dryRun: false, force: true });
  assert.throws(() => parseHealthNotifyOptions({ dryRun: "true" }), /boolean/);
  assert.throws(() => parseHealthNotifyOptions({ force: true, dryRun: true }), /not both/);
  assert.throws(() => parseHealthNotifyOptions({ force: true, project_code: "TEST" }), /Unknown field/);
  assert.throws(() => parseHealthNotifyOptions([]), /JSON object/);
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

function fakeDependencies(lookup = false) {
  const calls: string[] = [];
  const deps: HealthNotificationDependencies = {
    alreadyClaimed: async () => { calls.push("lookup"); return lookup; },
    claim: async () => { calls.push("claim"); return true; },
    read: async () => { calls.push("read"); return { health: [], strips: {}, faults: {}, notices: [] }; },
    send: async () => { calls.push("send"); return "queued"; },
    record: async (_key, outcome) => { calls.push(`record:${outcome}`); },
  };
  return { calls, deps };
}

test("dryRun previews outside the schedule without ledger or listener calls", async () => {
  const { calls, deps } = fakeDependencies();
  const result = await executeHealthNotification(new Date("2026-10-23T02:00:00Z"), { dryRun: true, force: false }, deps);
  assert.deepEqual(calls, ["read"]);
  assert.equal(result.delivered, 0);
  assert.ok("message" in result);
  assert.match(result.message ?? "", /HALO Data Health · 2026-10-23 02:00–2026-10-23 10:00 SGT/);
});

test("force sends outside the schedule and bypasses the ledger", async () => {
  const { calls, deps } = fakeDependencies(true);
  const result = await executeHealthNotification(new Date("2026-10-23T02:00:00Z"), { dryRun: false, force: true }, deps);
  assert.deepEqual(calls, ["read", "send"]);
  assert.equal(result.delivered, 1);
  assert.ok("outcome" in result);
  assert.equal(result.outcome, "queued");
});

test("the scheduled path skips ordinary ticks and already-claimed windows", async () => {
  const idle = fakeDependencies();
  assert.equal((await executeHealthNotification(new Date("2026-10-23T02:00:00Z"), { dryRun: false, force: false }, idle.deps)).delivered, 0);
  assert.deepEqual(idle.calls, []);

  const duplicate = fakeDependencies(true);
  assert.equal((await executeHealthNotification(new Date("2026-10-23T00:05:00Z"), { dryRun: false, force: false }, duplicate.deps)).delivered, 0);
  assert.deepEqual(duplicate.calls, ["lookup"]);
});

test("a due scheduled window claims once and records the listener outcome", async () => {
  const { calls, deps } = fakeDependencies();
  const result = await executeHealthNotification(new Date("2026-10-23T00:05:00Z"), { dryRun: false, force: false }, deps);
  assert.deepEqual(calls, ["lookup", "read", "claim", "send", "record:queued"]);
  assert.equal(result.delivered, 1);
});

test("an uncertain scheduled send stays claimed, while a forced failure writes no claim", async () => {
  const scheduled = fakeDependencies();
  scheduled.deps.send = async () => { scheduled.calls.push("send"); throw new Error("listener timeout"); };
  await assert.rejects(
    executeHealthNotification(new Date("2026-10-23T00:05:00Z"), { dryRun: false, force: false }, scheduled.deps),
    /listener timeout/,
  );
  assert.deepEqual(scheduled.calls, ["lookup", "read", "claim", "send", "record:unconfirmed"]);

  const forced = fakeDependencies();
  forced.deps.send = async () => { forced.calls.push("send"); throw new Error("listener timeout"); };
  await assert.rejects(
    executeHealthNotification(new Date("2026-10-23T02:00:00Z"), { dryRun: false, force: true }, forced.deps),
    /listener timeout/,
  );
  assert.deepEqual(forced.calls, ["read", "send"]);
});
