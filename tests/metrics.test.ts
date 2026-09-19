import assert from "node:assert/strict";
import test from "node:test";

import { createMetrics, SAMPLE_CAP } from "../lib/metrics";

test("a recorded operation reports how often and how long", () => {
  const metrics = createMetrics();
  for (const ms of [10, 20, 30]) metrics.record("read", ms);

  const [stat] = metrics.snapshot();
  assert.equal(stat.name, "read");
  assert.equal(stat.count, 3);
  assert.equal(stat.total, 60);
  assert.equal(stat.mean, 20);
  assert.equal(stat.max, 30);
});

test("percentiles are a duration something actually took", () => {
  const metrics = createMetrics();
  // 1..100. An interpolating p95 would invent a value between two samples;
  // nearest-rank returns one that was really observed.
  for (let ms = 1; ms <= 100; ms += 1) metrics.record("call", ms);

  const [stat] = metrics.snapshot();
  assert.equal(stat.p50, 50);
  assert.equal(stat.p95, 95);
  assert.equal(stat.max, 100);
});

test("the sample window is bounded, and describes recent behaviour", () => {
  const metrics = createMetrics();
  // A slow start followed by a fast steady state: once the slow calls fall out
  // of the window the percentiles must follow, or a process that was slow at
  // boot looks slow forever.
  for (let i = 0; i < SAMPLE_CAP; i += 1) metrics.record("call", 1000);
  for (let i = 0; i < SAMPLE_CAP; i += 1) metrics.record("call", 5);

  const [stat] = metrics.snapshot();
  assert.equal(stat.p95, 5, "the slow era has aged out of the percentiles");
  assert.equal(stat.count, SAMPLE_CAP * 2, "but the count remembers every call");
  assert.equal(stat.max, 1000, "and so does the worst case");
});

test("timing tags success and failure, and never swallows the error", async () => {
  const metrics = createMetrics();
  await metrics.time("fetch", async () => "fine");
  await assert.rejects(
    () => metrics.time("fetch", async () => { throw new Error("upstream said no"); }),
    /upstream said no/,
  );

  const [stat] = metrics.snapshot();
  assert.equal(stat.count, 2, "a failed call is still a call that took time");
  assert.deepEqual(stat.tags, { ok: 1, error: 1 });
});

test("tags count things that are not durations", () => {
  const metrics = createMetrics();
  metrics.tag("configs", "hit");
  metrics.tag("configs", "hit");
  metrics.tag("configs", "miss");

  const [stat] = metrics.snapshot();
  assert.deepEqual(stat.tags, { hit: 2, miss: 1 });
  assert.equal(stat.count, 0, "tagging is not timing");
});

test("the snapshot leads with what costs the most time in total", () => {
  const metrics = createMetrics();
  // One slow call against many quick ones: the list decides what to work on,
  // and 200 x 40ms deserves attention before a single 900ms outlier.
  metrics.record("rare-and-slow", 900);
  for (let i = 0; i < 200; i += 1) metrics.record("common-and-quick", 40);

  assert.deepEqual(metrics.snapshot().map((stat) => stat.name), ["common-and-quick", "rare-and-slow"]);
});
