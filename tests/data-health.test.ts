import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessIngestionHealth,
  dataHealthDetail,
  healthBadge,
  healthKey,
  healthTarget,
} from "../lib/data-health";

const NOW = new Date("2026-09-26T12:00:00.000Z");

test("automatic health targets use the existing WBGT and Noise table conventions", () => {
  assert.deepEqual(healthTarget("wbgt", "C 991"), {
    service: "wbgt",
    projectCode: "C 991",
    schema: "wbgts",
    table: "c_991_wbgt_data_hourly",
    warningAfterMs: 2 * 60 * 60 * 1000,
    criticalAfterMs: 4 * 60 * 60 * 1000,
    sourceTimeFields: ["reading_timestamp"],
  });
  assert.deepEqual(healthTarget("noise", "CR 106"), {
    service: "noise",
    projectCode: "CR 106",
    schema: "noise-meters",
    table: "cr_106_noise_data_daily",
    warningAfterMs: 12 * 60 * 60 * 1000,
    criticalAfterMs: 24 * 60 * 60 * 1000,
    sourceTimeFields: ["date", "time_hhmm"],
  });
  assert.equal(healthTarget("haze", "C991"), null);
  assert.equal(healthTarget("wbgt", "!!!"), null);
  assert.equal(healthTarget("noise", "1"), null);
});

test("ingestion freshness moves from receiving to delayed to no recent data at exact pilot boundaries", () => {
  const target = healthTarget("wbgt", "C991");
  assert.ok(target);

  assert.equal(assessIngestionHealth(target, { kind: "row", createdAt: "2026-09-26T10:00:00.001Z" }, NOW).tone, "good");
  assert.equal(assessIngestionHealth(target, { kind: "row", createdAt: "2026-09-26T10:00:00.000Z" }, NOW).tone, "warn");
  assert.equal(assessIngestionHealth(target, { kind: "row", createdAt: "2026-09-26T08:00:00.000Z" }, NOW).tone, "danger");
  assert.equal(assessIngestionHealth(target, { kind: "empty" }, NOW).label, "Data: no data received yet");
});

test("invalid and future receipt timestamps do not appear fresh, and source-table failures keep their own wording", () => {
  const target = healthTarget("noise", "WCP");
  assert.ok(target);

  assert.deepEqual(assessIngestionHealth(target, { kind: "row", createdAt: "not-a-date" }, NOW), {
    service: "noise",
    projectCode: "WCP",
    tone: "neutral",
    label: "Data: receipt time unavailable",
    newestReceivedAt: null,
    sourceEventAt: null,
  });
  assert.equal(assessIngestionHealth(target, { kind: "row", createdAt: "2026-09-26T12:01:00.000Z" }, NOW).label, "Data: receipt time is in the future");
  assert.equal(assessIngestionHealth(target, { kind: "missing_table" }, NOW).label, "Data: table unavailable");
  assert.equal(assessIngestionHealth(target, { kind: "monitor_error" }, NOW).label, "Data: monitor unavailable");
});

test("health keys isolate identical project codes in different services", () => {
  assert.notEqual(healthKey("wbgt", "MBS"), healthKey("noise", "MBS"));
  assert.equal(healthKey("wbgt", "MBS"), healthKey("wbgt", "MBS"));
});

test("only unsupported services say not yet covered; covered failures retain their status explanation", () => {
  const target = healthTarget("wbgt", "C991");
  assert.ok(target);
  assert.equal(dataHealthDetail(undefined), "Monitoring is automatic. This service is not yet covered by the pilot.");
  assert.equal(
    dataHealthDetail(assessIngestionHealth(target, { kind: "missing_table" }, NOW)),
    "Monitoring is automatic. This project is covered; no receipt timestamp is available.",
  );
  assert.equal(
    dataHealthDetail(assessIngestionHealth(target, { kind: "row", createdAt: "2026-09-26T11:00:00.000Z" }, NOW)),
    "Monitoring is automatic. This project is covered.",
  );
});

test("provider acceptance remains distinct from delivery and read", () => {
  assert.deepEqual(healthBadge("provider_accepted"), {
    tone: "good",
    label: "Delivery: Provider accepted",
  });
});
