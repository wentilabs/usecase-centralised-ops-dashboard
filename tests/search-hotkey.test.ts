import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { shouldFocusPropose, shouldFocusSearch, type HotkeyEvent } from "../lib/search-hotkey";

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

test("⌘P jumps to the propose bar, and yields to Print on a second press", () => {
  const pressP = (over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
    key: "p", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...over,
  });

  assert.equal(shouldFocusPropose(pressP(), false), true);
  assert.equal(shouldFocusPropose(pressP({ metaKey: false, ctrlKey: true }), false), true, "Ctrl+P off a Mac");
  assert.equal(shouldFocusPropose(pressP({ key: "P" }), false), true, "caps lock still counts");

  // Print is a shortcut people press on purpose. Once the bar has focus the
  // second press must reach the browser, or there is no way to print at all.
  assert.equal(shouldFocusPropose(pressP(), true), false);

  // The modified forms belong elsewhere.
  assert.equal(shouldFocusPropose(pressP({ shiftKey: true }), false), false);
  assert.equal(shouldFocusPropose(pressP({ altKey: true }), false), false);
  assert.equal(shouldFocusPropose(pressP({ metaKey: false, ctrlKey: false }), false), false, "bare p types");

  // The two shortcuts must not answer for each other.
  assert.equal(shouldFocusPropose({ ...pressP(), key: "f" }, false), false);
  assert.equal(shouldFocusSearch(pressP(), false), false);
});

test("both hotkeys are wired to the visible copy of their control", async () => {
  // Two of each are mounted — phone row and desktop header — and focusing the
  // hidden one looks like the shortcut silently doing nothing.
  const shell = await readFile(resolve("components/DashboardShell.tsx"), "utf8");
  assert.match(shell, /proposeInputs/, "the propose inputs must be collected");
  assert.match(shell, /offsetParent !== null/, "visibility decides which one takes the key");
  assert.equal((shell.match(/proposeInputs\.current\[\d\] = element/g) ?? []).length, 2,
    "both copies must register");
  const chat = await readFile(resolve("components/SmartChat.tsx"), "utf8");
  assert.match(chat, /ref=\{registerInput\}/, "SmartChat must hand its input up");
  assert.match(chat, /ring-2 ring-primary\/70/, "a keyboard-caused jump must be visible");
});
