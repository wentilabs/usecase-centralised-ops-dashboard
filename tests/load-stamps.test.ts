import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { LOADING, clockSgt, describeLoad, durationText, failed, finished } from "../lib/load-stamps";

/**
 * The page is no longer one wait: configuration arrives with the document, health and history arrive
 * after it. A single "fetched" time said when the first landed and nothing about the rest, so a card
 * with no strip yet looked identical to a card with no history, and nobody could tell a slow load from a
 * stuck one. Each load now says what it is doing, when it finished and how long it took.
 */
test("the time is Singapore's, to the second", () => {
  assert.equal(clockSgt("2026-10-20T11:20:43.000Z"), "19:20:43");
  assert.equal(clockSgt("2026-10-20T16:00:00.000Z"), "00:00:00", "across midnight");
  assert.equal(clockSgt("not a time"), "");
});

test("a duration is milliseconds under a second and seconds above it", () => {
  assert.equal(durationText(40), "40 ms");
  assert.equal(durationText(660), "660 ms");
  assert.equal(durationText(949), "949 ms");
  assert.equal(durationText(950), "1.0 s");
  assert.equal(durationText(2900), "2.9 s");
  assert.equal(durationText(Number.NaN), "");
  assert.equal(durationText(-5), "");
});

test("each state says what it is", () => {
  assert.equal(describeLoad("health", LOADING), "health loading…");
  assert.equal(describeLoad("health", { state: "done", at: "2026-10-20T11:20:47.000Z", ms: 2900 }), "health 19:20:47 · 2.9 s");
  assert.equal(describeLoad("configs", { state: "done", at: "2026-10-20T11:20:43.000Z" }), "configs 19:20:43", "no duration, no dangling separator");
  assert.equal(describeLoad("history", failed(() => "2026-10-20T11:21:00.000Z")), "history failed 19:21:00");
  assert.equal(describeLoad("history", { state: "failed" }), "history failed");
});

test("a finished load is timed from when it started", () => {
  const load = finished(1000, () => 3650, () => "2026-10-20T11:20:47.000Z");
  assert.deepEqual(load, { state: "done", at: "2026-10-20T11:20:47.000Z", ms: 2650 });
});

test("the header and the board show the same stamps, and a failed load never replaces what was on screen", async () => {
  const shell = await readFile(resolve("components/DashboardShell.tsx"), "utf8");
  assert.match(shell, /<LoadStamps loads=\{loadItems\} \/>/, "the header");
  assert.match(shell, /strips=\{projectStrips\}\s+hazeHourlyCheckUnavailable=\{[^}]+\}\s+loads=\{loadItems\}/, "handed to the board from the same list, so the two cannot disagree");
  assert.match(shell, /\.catch\(\(\) => live && record\(failed\(\)\)\)/, "a failure is recorded as one");
  const loader = shell.slice(shell.indexOf("const fetchedPage"), shell.indexOf("fetchedPage(\"/api/data-health\""));
  assert.doesNotMatch(loader, /setProjectStrips\(\{\}\)|setLiveHealth\(\[\]\)/, "and never blanks what was already there");
  const board = await readFile(resolve("components/DataHealthBoard.tsx"), "utf8");
  assert.match(board, /<LoadStamps loads=\{loads\} \/>/);
});

test("the Data Health board has room: a gap between its sections, space beneath the last, and times that wrap", async () => {
  const board = await readFile(resolve("components/DataHealthBoard.tsx"), "utf8");
  // The incident list once sat flush against the panel above it and against the bottom of the dialog.
  assert.match(board, /flex flex-col gap-7 overflow-y-auto px-5 pb-7 pt-5/);
  // "20 Oct, 18:05 SGT" on one nowrap line overflowed its column and was cut off at "20 Oct, 18".
  assert.doesNotMatch(board, /whitespace-nowrap[^"]*font-mono text-\[10px\][^"]*text-muted-foreground">\s*\{processTime/);
  assert.match(board, /<div>\{day\}<\/div>\s*<div>\{clock \? `\$\{clock\} SGT` : "SGT"\}<\/div>/, "date over time");
  assert.match(board, /Issues by service/, "the second list is named, like the first");
  // The sections' own margins would double the gap.
  assert.doesNotMatch(board, /className="mt-4 border-t/);
});

test("the page's first byte does not wait for the readings-age health", async () => {
  const page = await readFile(resolve("app/page.tsx"), "utf8");
  assert.doesNotMatch(page, /listEstateHealth|listProjectHealth|readings-age health", \(\) =>/, "3.6 s of a 3.7 s render was this read");
  assert.match(page, /serverRenderMs/, "and the page says how long it did take");
  const route = await readFile(resolve("app/api/data-health/route.ts"), "utf8");
  assert.match(route, /listEstateHealth\(\)\.catch\(\(\) => null\)/, "a failed read is null, never an empty list");
  assert.match(route, /tookMs/);
});
