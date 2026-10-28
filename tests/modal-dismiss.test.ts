import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

/**
 * Every modal can be closed by clicking outside it.
 *
 * A modal is any element that covers the screen with `fixed inset-0` AND is a backdrop: a
 * dimming colour (`bg-black/…`, or the translucent `bg-background/…` blur) or a dialog role.
 * Each must either spread `useBackdropDismiss` (which also refuses a click that began inside the
 * panel, so selecting text never closes it) or carry its own `onClick` to close.
 *
 * Full-screen views that have no outside, like the lightning map, use `bg-background` solid and
 * are not backdrops.
 */
test("every modal backdrop closes on a click outside the panel", async () => {
  const dir = resolve("components");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".tsx"));
  const offenders: string[] = [];
  let checked = 0;
  for (const name of files) {
    const source = await readFile(resolve(dir, name), "utf8");
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (!line.includes("fixed inset-0")) return;
      // The element's opening tag runs until its `>`; backdrops put the handler on it.
      const tag = lines.slice(Math.max(0, index - 3), index + 7).join("\n");
      const isBackdrop = /bg-black\/|bg-background\/\d|role="dialog"/.test(line) || /bg-black\/|bg-background\/\d/.test(tag.split("\n").slice(3, 5).join("\n"));
      if (!isBackdrop || /^\s*(\/\/|\*)/.test(line)) return;
      checked += 1;
      const closes = /\{\.\.\.dismiss\w*\}|onClick=\{/.test(tag);
      if (!closes) offenders.push(`${name}:${index + 1}`);
    });
  }
  assert.ok(checked >= 14, `expected to find the known modals, found ${checked}`);
  assert.deepEqual(offenders, [], "a backdrop with no way to close it by clicking outside");
});
