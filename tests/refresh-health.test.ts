import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { refreshUpdates } from "../lib/health-refresh";

/**
 * Health is held for a while on purpose — the strips cost a second of paging each — which is right for
 * a page left open and wrong for someone who has just fixed a sheet and wants to know whether it
 * cleared. "Refresh data health" forgets all of it and reads it again. Two things have to be right:
 * that it really forgets every layer that remembers, and that a read that FAILS never looks like a
 * read that found nothing.
 */
const NOW = () => "2026-10-20T07:30:00.000Z";
const source = (path: string) => readFile(resolve(path), "utf8");

test("every part that was read replaces what was on screen, and the server's time is the time shown", () => {
  const updates = refreshUpdates({
    health: [{ service: "wbgt", projectCode: "CCCC", tone: "good" }],
    strips: { a: [] },
    faults: { b: "stuck" },
    notices: [{ id: "tick", colour: "red", label: "x", detail: null }],
    fetchedAt: "2026-10-20T07:29:58.000Z",
  }, NOW);
  assert.equal(updates.health?.length, 1);
  assert.deepEqual(updates.strips, { a: [] });
  assert.deepEqual(updates.faults, { b: "stuck" });
  assert.equal(updates.notices?.length, 1);
  assert.equal(updates.refreshedAt, "2026-10-20T07:29:58.000Z");
});

test("a part the server could not read changes nothing, however empty it would have looked", () => {
  // The route says `null` for a failed read. An empty object in its place would blank every card's
  // history and clear every standing fault: "could not look" drawn as "nothing is wrong".
  const updates = refreshUpdates({ health: null, strips: null, faults: null, notices: null, fetchedAt: null }, NOW);
  assert.deepEqual(Object.keys(updates), ["refreshedAt"], "nothing to apply");
  assert.equal(updates.refreshedAt, NOW(), "falls back to the browser's clock only when the server gave none");
});

test("a legitimately empty answer IS applied: no faults any more is exactly what a fix looks like", () => {
  const updates = refreshUpdates({ health: [], strips: {}, faults: {}, notices: [] }, NOW);
  assert.deepEqual(updates.health, []);
  assert.deepEqual(updates.faults, {}, "the SGK fault, once fixed, must be able to clear");
  assert.deepEqual(updates.notices, []);
});

test("a malformed answer changes nothing rather than something wrong", () => {
  for (const body of [undefined, null, "oops", 42, [], { health: {}, strips: [], faults: "x", notices: {} }]) {
    const updates = refreshUpdates(body, NOW);
    assert.deepEqual(Object.keys(updates), ["refreshedAt"], JSON.stringify(body));
  }
});

test("the reset forgets every layer that remembers, before anything is read", async () => {
  const repository = await source("lib/config-repository.ts");
  const forget = repository.slice(repository.indexOf("export function forgetHealthCaches"));
  const body = forget.slice(0, forget.indexOf("\n}\n"));
  for (const cache of ["stripCache", "faultCache", "lightningCache", "healthCache", "configCache"]) {
    assert.match(body, new RegExp(`${cache}\\.forget\\(\\)`), `${cache} must be forgotten or a refresh reads stale`);
  }

  const route = await source("app/api/data-health/refresh/route.ts");
  const forgotten = route.indexOf("forgetHealthCaches()");
  // Asserted present first: a missing call would make every comparison below pass on -1.
  assert.ok(forgotten >= 0, "the route must actually forget the caches");
  assert.ok(forgotten < route.indexOf("listEstateHealth("), "forgotten before the health is re-read");
  assert.ok(forgotten < route.indexOf("listProjectStrips()"), "and before the strips");
  assert.match(route, /export async function POST/, "it discards state, so it is a POST");
  assert.match(route, /Unauthorized[\s\S]*401/, "behind the same session as the rest");
});

test("a failed read is reported as null, never as an empty answer", async () => {
  const route = await source("app/api/data-health/refresh/route.ts");
  for (const read of ["listEstateHealth", "listProjectStrips", "listProjectFaults", "listServiceNotices"]) {
    assert.match(route, new RegExp(`${read}\\([^)]*\\)[^\\n]*catch\\(\\(\\) => null\\)`), `${read} must answer null on failure`);
  }
  assert.doesNotMatch(route, /catch\(\(\) => \(\{\}\)\)|catch\(\(\) => \[\]\)/, "an empty answer would be applied as 'nothing wrong'");
});

test("the button is on the strip and in the board, says what it is doing, and cannot be double-clicked", async () => {
  const button = await source("components/RefreshHealthButton.tsx");
  assert.match(button, /aria-label="Refresh data health"/);
  assert.match(button, /↻<\/span> Refresh health\n/, "not a bare 'Refresh': the header already has one, for configuration");
  assert.match(button, /disabled=\{refreshing\}/, "a read that takes a second must not be started twice");
  assert.match(button, /"Refreshing…"/);
  assert.match(button, /Could not refresh — showing what was already here/);
  assert.match(button, /Updated \$\{formatSgt\(refreshedAt\)\} SGT/);

  const shell = await source("components/DashboardShell.tsx");
  assert.match(shell, /<RefreshHealthButton[\s\S]*?refreshing=\{refreshingHealth\}/, "beside the estate strip");
  assert.match(shell, /refreshUpdates\(await response\.json\(\)\)/, "applied only through the one rule");
  assert.match(shell, /onRefresh=\{\(\) => void refreshHealth\(\)\}\s+refreshing=\{refreshingHealth\}\s+refreshedAt/, "and handed to the board");
  assert.match(shell, /new Map\(liveHealth\.map\(/, "the cards read the refreshed health, not the first render's");
  assert.doesNotMatch(shell, /new Map\(projectHealth\.map\(/);

  const board = await source("components/DataHealthBoard.tsx");
  assert.match(board, /<RefreshHealthButton onRefresh=\{refreshBoard\}/, "and in the board's header, where a fix is checked");
  assert.match(board, /const refreshBoard = \(\) => \{ onRefresh\?\.\(\); setHandlerReadRevision/, "refresh rereads both health and handler records");
});
