import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { colourForRun, colourForStatus, isStaleReadingLog, worstColour } from "../lib/health-status";
import { colourOfTone, summarise, summaryLine, type BoardEntry } from "../lib/health-board";
import { bySeverity, severityOf, staleCount, troubleCount, troubleIn, type Bar } from "../lib/health-timeline";

/**
 * A late reading is the sensor's problem, not the pipeline's, and it was the single
 * largest source of amber. Over the fortnight to 20 Oct 2026, 10,968 of Noise's
 * 12,089 `completed_with_meter_issues` runs wrote only "Stale latest rows: …", and
 * 2,156 of WBGT's 3,049 `completed_with_issues` runs wrote only "… reading 84 minutes
 * old; production delivery suppressed". Amber has to keep meaning "a developer should
 * look", so these are `stale` — dark green — and never counted as needing action.
 *
 * The services' wording is read, never changed. Every line is the real shape the
 * service writes.
 */
const WBGT_STALE = "MBS IR2 (WC-3): reading 84 minutes old; production delivery suppressed";
const NOISE_STALE = "Stale latest rows: PN NM01 Watertown Blk 71 Punggol Central (RT), PN NM02 Valour Primary School RT";

test("a run that only reported late readings is stale, in both services' own words", () => {
  const wbgt = colourForRun("wbgt", "completed_with_issues", [WBGT_STALE]);
  assert.equal(wbgt.colour, "stale");
  assert.equal(wbgt.status, "completed_with_issues", "the service's own word is never rewritten");
  assert.equal(wbgt.basis, "stale-message");

  assert.equal(colourForRun("noise", "completed_with_meter_issues", [NOISE_STALE]).colour, "stale");
  // WBGT writes one line per sensor; all of them late is still only lateness.
  assert.equal(colourForRun("wbgt", "completed_with_issues", [WBGT_STALE, "WBGT 5 Tuas Cres (WC-9): reading 33 minutes old; production delivery suppressed"]).colour, "stale");
});

test("a late reading never hides a different problem in the same run", () => {
  assert.equal(
    colourForRun("wbgt", "completed_with_issues", [WBGT_STALE, "Missing configured sensors: WBGT C3 (Manual)"]).colour,
    "amber",
    "one line that is not lateness keeps the run amber",
  );
  assert.equal(colourForRun("noise", "completed_with_meter_issues", [NOISE_STALE, "Reading table x is not accessible"]).colour, "amber");
  // Nothing written is not evidence of lateness.
  assert.equal(colourForRun("wbgt", "completed_with_issues", []).colour, "amber");
});

test("only a run that completed is softened — a failure keeps its colour", () => {
  assert.equal(colourForRun("wbgt", "failed_unhandled_error", [WBGT_STALE]).colour, "red", "a stale line in a failed run is a symptom");
  assert.equal(colourForRun("noise", "failed_config_validation", [NOISE_STALE]).colour, "red");
  // A service's own declaration outranks the message rule, in both directions.
  const declaredAmber = colourForRun("wbgt", "completed_with_issues", [WBGT_STALE], () => "amber");
  assert.equal(declaredAmber.colour, "amber");
  assert.equal(declaredAmber.basis, "declared");
});

test("the phrases belong to the service that writes them", () => {
  // Another service's identical-looking text is not assumed to mean lateness.
  assert.equal(isStaleReadingLog("haze", [WBGT_STALE]), false);
  assert.equal(isStaleReadingLog("issueChaser", [NOISE_STALE]), false);
  assert.equal(isStaleReadingLog("wbgt", [NOISE_STALE]), false, "WBGT does not write Noise's wording");
  assert.equal(isStaleReadingLog("noise", [WBGT_STALE]), false);
});

test("a service can declare a status stale itself, which outranks every guess here", () => {
  // The path for a service that would rather give lateness its own status than be
  // recognised by its wording: `completed_with_stale_readings: "stale"` in its contract.
  const declared = colourForStatus("wbgt", "completed_with_stale_readings", () => "stale");
  assert.equal(declared.colour, "stale");
  assert.equal(declared.basis, "declared");
});

test("a send the listener gave up on is red, by name", () => {
  // `dropped` is what a service writes once it has reconciled a queued send and found
  // the listener will never make it. Final and undelivered, so red — whatever follows.
  for (const status of ["dropped", "dropped_not_participant", "DROPPED"]) {
    assert.equal(colourForStatus("issueChaser", status).colour, "red", status);
  }
});

test("the worst colour ranks red, amber, stale, green", () => {
  assert.equal(worstColour(["green", "stale"]), "stale");
  assert.equal(worstColour(["stale", "amber", "green"]), "amber");
  assert.equal(worstColour(["stale", "red", "amber"]), "red");
  assert.equal(worstColour(["green", "green"]), "green");
  assert.equal(colourOfTone("stale"), "stale");
});

const bar = (colour: Bar["colour"], at: string): Bar => ({ at, colour, status: colour, log: [] });

test("a strip counts late readings apart from what needs looking at", () => {
  const bars = [bar("green", "1"), bar("stale", "2"), bar("stale", "3"), bar("amber", "4"), bar("red", "5")];
  assert.equal(troubleCount(bars), 2, "red and amber only — a late reading is not a to-do");
  assert.equal(staleCount(bars), 2);
  // But the modal still lists them, with the service's lines: someone chasing a sensor needs them.
  assert.deepEqual(troubleIn(bars).map((b) => b.colour), ["red", "amber", "stale", "stale"]);
  assert.deepEqual(severityOf(bars), { red: 1, amber: 1, stale: 2, green: 1 });
});

test("a project with a sensor problem sorts above a clean one and below any real fault", () => {
  const sev = (red: number, amber: number, stale: number, green: number) => ({ red, amber, stale, green });
  assert.ok(bySeverity(sev(0, 0, 3, 90), sev(0, 0, 0, 100)) < 0, "findable, not buried among the clean");
  assert.ok(bySeverity(sev(0, 1, 0, 0), sev(0, 0, 99, 0)) < 0, "one amber outranks any number of late readings");
  assert.ok(bySeverity(sev(1, 0, 0, 0), sev(0, 50, 50, 0)) < 0, "and one red outranks everything");
});

const entry = (over: Partial<BoardEntry>): BoardEntry => ({
  service: "wbgt", projectCode: "A", signal: "ingestion", colour: "green", label: "receiving", detail: null, idle: false, ...over,
});

test("the board counts and lists late readings, but they are not an exception", () => {
  const summary = summarise([
    entry({ projectCode: "A", colour: "stale", label: "no recent data" }),
    entry({ projectCode: "B", colour: "stale", label: "no recent data" }),
    entry({ projectCode: "C", colour: "stale", label: "delayed", service: "noise" }),
    entry({ projectCode: "D", colour: "amber", label: "completed_with_issues", signal: "run" }),
    entry({ projectCode: "E", colour: "green" }),
  ]);
  assert.equal(summary.stale, 3);
  assert.equal(summary.amber, 1);
  assert.deepEqual(summary.exceptions.map((e) => e.projectCode), ["D"], "what needs acting on, and only that");
  assert.deepEqual(summary.incidents.map((i) => i.label), ["completed_with_issues"]);
  // Late readings are grouped the same way, in a section of their own.
  assert.deepEqual(summary.late.map((i) => [i.service, i.label, i.projects]), [["wbgt", "no recent data", ["A", "B"]], ["noise", "delayed", ["C"]]]);
});

test("a board with only late readings has nothing to action", () => {
  const summary = summarise([entry({ colour: "stale", label: "delayed" })]);
  assert.equal(summary.stale, 1);
  assert.equal(summary.exceptions.length, 0);
  assert.equal(summaryLine(summary), "nothing to action", "the strip must not colour itself for a late sensor");
});

test("the dark green is a real, themed colour in every place a colour is drawn", async () => {
  const read = (path: string) => readFile(resolve(path), "utf8");
  assert.match(await read("app/globals.css"), /--stale: [\d.]+ [\d.]+% [\d.]+%;/);
  assert.match(await read("app/globals.css"), /--stale-text:/);
  assert.match(await read("tailwind.config.ts"), /stale: "hsl\(var\(--stale\)\)"/);
  assert.match(await read("components/HealthBars.tsx"), /stale: "bg-stale"/, "the strip's bars");
  assert.match(await read("components/DataHealthRow.tsx"), /colour === "stale"/, "the card's pill");
  assert.match(await read("components/HealthStrip.tsx"), /summary\.stale/, "the estate strip");
  assert.match(await read("components/DataHealthBoard.tsx"), /summary\.late/, "the board's late-readings section");
});
