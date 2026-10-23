import assert from "node:assert/strict";
import test from "node:test";

import { healthAlerts } from "../lib/health-notifications";

const now = new Date("2026-10-23T02:00:00.000Z"); // 10:00 SGT
const empty = { now, health: [], strips: {}, faults: {}, notices: [] };

test("notification selection is silent outside office hours", () => {
  assert.deepEqual(healthAlerts({ ...empty, now: new Date("2026-10-23T15:00:00Z"), faults: { '["noise","TJR"]': "broken" } }), []);
});

test("only the newest recent failed process is alerted, with its logged details", () => {
  const result = healthAlerts({
    ...empty,
    strips: { '["noise","TJR"]': [
      { at: "2026-10-23T01:00:00Z", colour: "red", status: "failed", log: ["old error"] },
      { at: "2026-10-23T01:58:00Z", colour: "amber", status: "completed_with_meter_issues", kind: "scrape-noiselynx", log: ["NM02 missing"] },
    ] },
  });
  assert.equal(result.length, 1);
  assert.match(result[0].message, /^🟠 TJR · Noise — Process issue/);
  assert.match(result[0].message, /• NM02 missing/);
  assert.doesNotMatch(result[0].message, /old error/);
});

test("recovered processes are silent and stale readings use four-hour slots", () => {
  const health = [{ service: "wbgt" as const, projectCode: "TJR", tone: "stale" as const, label: "Data: late", newestReceivedAt: null, sourceEventAt: null }];
  assert.equal(healthAlerts({ ...empty, health, now: new Date("2026-10-23T01:00:00Z") }).length, 0);
  assert.equal(healthAlerts({ ...empty, health, now: new Date("2026-10-23T00:00:00Z") }).length, 1);
  assert.equal(healthAlerts({ ...empty, strips: { '["wbgt","TJR"]': [{ at: now.toISOString(), colour: "green", status: "sent", log: [] }] } }).length, 0);
});

test("changing reading age does not create a new delivery key every poll", () => {
  const health = [{ service: "noise" as const, projectCode: "TJR", tone: "danger" as const, label: "Data: no reading", newestReceivedAt: null, sourceEventAt: null, evidence: ["42 minutes old"] }];
  const first = healthAlerts({ ...empty, health })[0];
  const second = healthAlerts({ ...empty, health: [{ ...health[0], evidence: ["47 minutes old"] }] })[0];
  assert.equal(first.key, second.key);
});
