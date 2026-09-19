import assert from "node:assert/strict";
import test from "node:test";

import { createTtlCache } from "../lib/ttl-cache";

test("a cached value is returned until it is older than the window", () => {
  let clock = 1_000;
  const cache = createTtlCache<string, number>(6_000, () => clock);

  cache.set("wbgt", 1);
  assert.equal(cache.get("wbgt"), 1);

  clock += 5_999;
  assert.equal(cache.get("wbgt"), 1, "still inside the window");

  clock += 2;
  assert.equal(cache.get("wbgt"), undefined, "past the window it is gone");
});

test("an expired entry is dropped, not merely hidden", () => {
  let clock = 0;
  const cache = createTtlCache<string, number>(1_000, () => clock);
  cache.set("noise", 1);
  clock += 5_000;
  // fresh() must agree with get(): an entry nobody can read is not held.
  assert.deepEqual(cache.fresh(), []);
  assert.equal(cache.get("noise"), undefined);
  assert.deepEqual(cache.fresh(), []);
});

test("forgetting takes one key, or everything", () => {
  const cache = createTtlCache<string, number>(60_000);
  cache.set("wbgt", 1);
  cache.set("noise", 2);

  cache.forget("wbgt");
  assert.deepEqual(cache.fresh(), ["noise"], "only the named key goes");

  cache.forget();
  assert.deepEqual(cache.fresh(), [], "no argument clears everything");
});

test("a zero window caches nothing", () => {
  // The switch that turns it off: writes call forget(), but a deployment that
  // cannot tolerate any staleness should be able to set the window to zero and
  // get the old behaviour rather than a subtly different one.
  let clock = 0;
  const cache = createTtlCache<string, number>(0, () => clock);
  cache.set("haze", 1);
  assert.equal(cache.get("haze"), undefined);
});
