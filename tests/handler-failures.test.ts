import assert from "node:assert/strict";
import test from "node:test";

import { handlerFailureRows } from "../lib/handler-failures";

test("HALO accepts service-written reasons and rejects malformed rows", () => {
  assert.deepEqual(handlerFailureRows([
    { service_key: "haze", route: "/api/haze-hourly", reason: "bad format", occurred_at: "2026-10-26T06:00:00Z" },
    { service_key: "unknown", reason: "x", occurred_at: "2026-10-26T06:00:00Z" },
    { service_key: "haze", reason: "", occurred_at: "2026-10-26T06:00:00Z" },
  ]), [{ service: "haze", route: "/api/haze-hourly", reason: "bad format", at: "2026-10-26T06:00:00Z" }]);
});
