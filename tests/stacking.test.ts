import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

/**
 * The sticky header was painting beneath the cards' Data Health strips.
 *
 * Each card's Data Health section is lifted to `z-30` so its strip can be clicked above the card's mobile tap
 * overlay. The header was also `z-30`, and equal layers are decided by page order — the cards come later, so
 * their strips painted over the header as it scrolled past. The header has to sit strictly above that layer,
 * and strictly below the modal backdrops (`z-40`), which must still dim it. Pinned as numbers, so a change to
 * any of the three says which neighbour it has now collided with.
 */
const read = (path: string) => readFile(resolve(path), "utf8");
const layer = (source: string, anchor: RegExp): number => {
  const line = source.split("\n").find((candidate) => anchor.test(candidate));
  assert.ok(line, `no line matches ${anchor}`);
  const match = line.match(/\bz-(?:\[(\d+)\]|(\d+))/);
  assert.ok(match, `no z-index on: ${line.trim().slice(0, 80)}`);
  return Number(match[1] ?? match[2]);
};

test("the sticky headers sit above the cards' Data Health strips and below every modal backdrop", async () => {
  const shell = await read("components/DashboardShell.tsx");
  const headers = shell.split("\n").filter((line) => /<header className="sticky top-0/.test(line));
  assert.equal(headers.length, 2, "the phone header and the desktop header");
  const strip = layer(await read("components/DataHealthRow.tsx"), /<section className="pointer-events-none relative z-\d+ mt-auto/);
  const backdrops = [
    layer(await read("components/ServiceDrawer.tsx"), /fixed inset-0 z-\d+ bg-black/),
    layer(await read("components/ProjectSheet.tsx"), /fixed inset-0 z-\d+ bg-black/),
    layer(await read("components/ConfigEditor.tsx"), /fixed inset-0 z-\d+ bg-black/),
  ];
  for (const header of headers) {
    const z = layer(header, /sticky/);
    assert.ok(z > strip, `header z-${z} must be above the strips' z-${strip}: equal layers go to whichever comes later in the page, which is the card`);
    for (const backdrop of backdrops) assert.ok(z < backdrop, `header z-${z} must stay below the backdrop's z-${backdrop}, or a modal would not dim it`);
  }
});
