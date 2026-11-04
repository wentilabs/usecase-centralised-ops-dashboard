import assert from "node:assert/strict";
import test from "node:test";
import { readProcessWindow } from "../lib/process-log";
import { stripsFrom } from "../lib/health-timeline";

test("Vibration combines reports and alerts into each project's delivery strip", async () => {
  const paths: string[] = [];
  const samples = await readProcessWindow("vibration", async path => {
    paths.push(path);
    if (/[?&]limit=1$/.test(path)) return { ok: true, body: [] };
    return { ok: true, body: [
      { project_code: "SKW", operation: "kickoff", status: "queued", created_at: "2026-11-04T00:00:00Z", last_error: null,
        health_deliveries: [{ destination: "one@g.us", status: "queued", queue_id: "q1", message_id: null }] },
      { project_code: "SKW", operation: "site-report", status: "partially_sent", created_at: "2026-11-03T23:59:00Z", last_error: "two@g.us: rejected",
        health_deliveries: [{ destination: "one@g.us", status: "sent", message_id: "m1" }, { destination: "two@g.us", status: "failed" }] },
      { project_code: "ABC", operation: "ppv-alert", status: "failed", created_at: "2026-11-03T23:58:00Z", last_error: "listener rejected", health_deliveries: [] },
    ] };
  }, 100, "2026-11-03T00:00:00Z");
  assert.ok(paths.every(path => path.startsWith("vibration_delivery_history?")));
  assert.deepEqual(samples.map(row => row.kind), ["kickoff", "site-report", "ppv-alert"]);
  assert.deepEqual(samples.map(row => row.colour), ["green", "amber", "red"]);
  assert.equal(samples[0].deliveries?.[0].queueId, "q1");
  assert.deepEqual(samples[1].log, ["two@g.us: rejected"]);
  const strips = stripsFrom(samples.map(row => ({ ...row, key: row.projectCode })));
  assert.equal(strips.get("SKW")?.length, 2);
  assert.equal(strips.get("ABC")?.length, 1);
});

test("a readable empty combined history does not show stale fallback alerts", async () => {
  const paths: string[] = [];
  const rows = await readProcessWindow("vibration", async path => {
    paths.push(path); return { ok: true, body: [] };
  }, 100, "2026-11-03T00:00:00Z");
  assert.deepEqual(rows, []);
  assert.ok(paths.every(path => path.startsWith("vibration_delivery_history?")));
});

test("an absent combined view keeps existing PPV acceptance evidence visible", async () => {
  const rows = await readProcessWindow("vibration", async path => {
    if (path.startsWith("vibration_delivery_history?")) return { ok: false, body: null };
    return { ok: true, body: [{ project_code: "SKW", status: "sent", created_at: "2026-11-04T00:00:00Z", last_error: null,
      health_deliveries: [{ destination: "one@g.us", status: "sent", message_id: "m1" }] }] };
  }, 100, "2026-11-03T00:00:00Z");
  assert.equal(rows[0].kind, "ppv-alert");
  assert.equal(rows[0].deliveries?.[0].messageId, "m1");
});
