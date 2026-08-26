import assert from "node:assert/strict";
import test from "node:test";

import { shouldFocusSearch } from "../lib/search-hotkey";

const press = (over: Partial<Parameters<typeof shouldFocusSearch>[0]> = {}) => ({
  key: "f",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

test("⌘F and Ctrl+F both take over the filter", () => {
  // Either modifier, rather than sniffing the platform.
  assert.ok(shouldFocusSearch(press({ metaKey: true }), false));
  assert.ok(shouldFocusSearch(press({ ctrlKey: true }), false));
  // Capital F is the same key with shift... which is NOT this shortcut, but a
  // capital arriving without shift (some layouts, some remaps) still is.
  assert.ok(shouldFocusSearch(press({ key: "F", metaKey: true }), false));
});

test("it leaves alone everything that is not the plain shortcut", () => {
  assert.equal(shouldFocusSearch(press(), false), false, "f on its own is typing");
  assert.equal(shouldFocusSearch(press({ key: "g", metaKey: true }), false), false);
  // ⌘⇧F and ⌥⌘F belong to the browser and to other tools.
  assert.equal(shouldFocusSearch(press({ metaKey: true, shiftKey: true }), false), false);
  assert.equal(shouldFocusSearch(press({ ctrlKey: true, altKey: true }), false), false);
});

test("a second press falls through to the browser's own find", () => {
  // Taking ⌘F away entirely would leave no way to search the text ON a card,
  // which is a real thing to want. So the override applies only while the filter
  // does not already have focus.
  assert.equal(shouldFocusSearch(press({ metaKey: true }), true), false);
  assert.ok(shouldFocusSearch(press({ metaKey: true }), false));
});
