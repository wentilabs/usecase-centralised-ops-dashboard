import { test } from "node:test";
import { strict as assert } from "node:assert";
import { missingServiceScheduleEntries, scheduleCoverage, type ServiceScheduleEvidence } from "../lib/service-schedule-health";

const evidence: ServiceScheduleEvidence = { checkedAt: "2026-10-27T05:00:00Z", sources: [
  { service: "lightning", state: "ready", routes: [{ route: "/api/lightning-kickoff", method: "POST", lastFinishedAt: "2026-10-24T23:30:01Z" }] },
  { service: "haze", state: "ready", routes: [{ route: "/api/haze-hourly", method: "POST", lastFinishedAt: "2026-10-24T00:00:00Z" }] },
] };
test("missing route requires a baseline and two elapsed runs; shared rules are not inferred", () => {
  const entries = missingServiceScheduleEntries(evidence);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].service, "lightning");
  assert.match(entries[0].label, /kickoff/i);
  assert.ok(scheduleCoverage(evidence).shared.some((entry) => entry.startsWith("haze:")));
  assert.ok(scheduleCoverage(evidence).unavailable.includes("wbgt"));
});
test("recent completion and missing baseline do not raise issues", () => {
  assert.deepEqual(missingServiceScheduleEntries({ ...evidence, sources: [{ service: "lightning", state: "ready", routes: [{ route: "/api/lightning-kickoff", method: "POST", lastFinishedAt: "2026-10-26T23:30:01Z" }] }] }), []);
  assert.deepEqual(missingServiceScheduleEntries({ ...evidence, sources: [{ service: "lightning", state: "ready", routes: [] }] }), []);
});
