import assert from "node:assert/strict";
import test from "node:test";

import { addressVariants, bestCandidate } from "../lib/geocode";

test("the form people actually paste is the form OneMap rejects", () => {
  // Measured against the live API, which is why this ladder exists:
  //   "8 Seletar West Rd 1, Singapore 798990"  → 0 results
  //   "8 Seletar West Rd 1, Singapore"         → 0 results
  //   "798990"                                 → 1, the right one
  //   "8 Seletar West Rd 1"                    → 1, the right one
  // The trailing country-and-postal is what breaks it, and it is what every
  // map app and every signature block produces.
  assert.deepEqual(addressVariants("8 Seletar West Rd 1, Singapore 798990"), [
    "8 Seletar West Rd 1, Singapore 798990",
    "798990",
    "8 Seletar West Rd 1",
  ]);
  assert.deepEqual(addressVariants("8 Seletar West Rd 1, Singapore"), [
    "8 Seletar West Rd 1, Singapore",
    "8 Seletar West Rd 1",
  ]);
  // A bare postal code needs no ladder, and must not produce a duplicate.
  assert.deepEqual(addressVariants("798990"), ["798990"]);
  // Nor does an address OneMap already likes.
  assert.deepEqual(addressVariants("8 Seletar West Rd 1"), ["8 Seletar West Rd 1"]);
});

test("a six-digit run inside a longer number is not a postal code", () => {
  // "Blk 123 #01-4567890" has six consecutive digits in it. Pulling those out
  // and searching for them would answer with a real building somewhere else,
  // which is worse than answering with nothing.
  assert.deepEqual(addressVariants("Blk 123 #01-4567890"), ["Blk 123 #01-4567890"]);
  // A real one still comes through when it stands alone.
  assert.ok(addressVariants("1 Marina Blvd 018989").includes("018989"));
});

test("the trailing comma forms are handled, and nothing empty is tried", () => {
  assert.deepEqual(addressVariants("  1 Raffles Place ,  "), ["1 Raffles Place"]);
  assert.deepEqual(addressVariants("   "), []);
  assert.deepEqual(addressVariants("Somewhere, SG"), ["Somewhere, SG", "Somewhere"]);
});

test("only a candidate inside the service area is picked", () => {
  // OneMap orders by relevance; an out-of-area match for a Singapore address
  // is a wrong match, not a distant site. Taking it would hand a CHECK
  // constraint a value nobody looked at.
  const at = (latitude: number, valid: boolean) => ({
    index: 0,
    address: "x",
    postal_code: null,
    latitude,
    longitude: 103.8,
    valid,
  });
  assert.equal(bestCandidate([at(-6.2, false), at(1.3, true)])?.latitude, 1.3, "skips past the out-of-area one");
  assert.equal(bestCandidate([at(-6.2, false)]), null, "and picks nothing rather than guessing");
  assert.equal(bestCandidate([]), null);
});
