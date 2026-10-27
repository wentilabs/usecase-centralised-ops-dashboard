import assert from "node:assert/strict";
import test from "node:test";

import { handlerFailureRows, vibrationRunFailureRows } from "../lib/handler-failures";

test("HALO accepts service-written reasons and rejects malformed rows", () => {
  assert.deepEqual(handlerFailureRows("haze", [
    { event_type: "handler_failure", route: "/api/haze-hourly", project_code: "IR2", reason: "bad format", occurred_at: "2026-10-26T06:00:00Z" },
    { reason: "", occurred_at: "2026-10-26T06:00:00Z" },
  ]), [{ service: "haze", route: "/api/haze-hourly", projectCode: "IR2", eventType: "handler_failure", reason: "bad format", at: "2026-10-26T06:00:00Z" }]);
  assert.deepEqual(handlerFailureRows("noise", [
    { service_key: "haze", reason: "ignore", occurred_at: "2026-10-26T06:00:00Z" },
    { service_key: "noise", route: "noise-hourly", reason: "failed", occurred_at: "2026-10-26T06:00:01Z" },
  ], true), [{ service: "noise", route: "noise-hourly", projectCode: null, eventType: "handler_failure", reason: "failed", at: "2026-10-26T06:00:01Z" }]);
});

test("partial vibration runs expose their service-recorded project reasons", () => {
  assert.deepEqual(vibrationRunFailureRows([{
    started_at: "2026-10-26T06:00:00Z", status: "partial",
    details: { errors: [{ project_code: "SKW", message: "source login failed" }] },
  }]), [{ service: "vibration", at: "2026-10-26T06:00:00Z", route: "vibration-scrape",
    projectCode: "SKW", eventType: "run_failure", reason: "source login failed" }]);
});
