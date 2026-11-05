import assert from "node:assert/strict";
import test from "node:test";
import { formatCopyErrorsReport } from "../lib/copy-errors";
import { summarise } from "../lib/health-board";
import { SERVICE_KEYS, SERVICES } from "../lib/services";

test("empty successful reads still report exact anomaly bounds and every service coverage", () => {
  const text = formatCopyErrorsReport({ summary: summarise([]), strips: {}, handlerReadState: "ready",
    handlerReport: { checkedAt: "2026-11-05T07:00:00.000Z", failures: [], sources: SERVICE_KEYS.map(service => ({ service, state: "ready" })) } });
  assert.match(text, /Anomaly checkedAt: 2026-11-05T07:00:00.000Z/);
  assert.match(text, /2026-11-03T07:00:00.000Z <= timestamp <= 2026-11-05T07:00:00.000Z/);
  for (const service of SERVICE_KEYS) assert.ok(text.includes(`${SERVICES[service].label}: ready`));
  assert.match(text, /current issues may predate/);
  assert.match(text, /Absence of findings does not establish health/);
});

test("missing, partial and legacy sources never disappear from coverage", () => {
  const text = formatCopyErrorsReport({ summary: summarise([]), strips: {}, handlerReadState: "ready",
    handlerReport: { checkedAt: "2026-11-05T07:00:00Z", failures: [], sources: [{service: "haze", state: "legacy"}, {service: "noise", state: "partial"}] } });
  assert.match(text, /Haze: legacy/);
  assert.match(text, /Noise: partial/);
  assert.match(text, /Subcon Activities: unavailable/);
});

test("unavailable or loading reads cannot invent a timestamp or complete coverage", () => {
  for (const handlerReadState of ["unavailable", "loading"] as const) {
    const text = formatCopyErrorsReport({ summary: summarise([]), strips: {}, handlerReport: null, handlerReadState });
    assert.match(text, /Anomaly checkedAt: unavailable/);
    assert.match(text, /Anomaly query window: unavailable/);
    assert.ok(text.includes(`Haze: ${handlerReadState}`));
  }
});
