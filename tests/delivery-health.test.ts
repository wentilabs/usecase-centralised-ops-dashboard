import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { deliveryEntries, incidentsFrom, summarise, type BoardEntry } from "../lib/health-board";
import { BOARD_SERVICES, boardSignalFor } from "../lib/process-log";
import { healthKey } from "../lib/data-health";
import type { Bar } from "../lib/health-timeline";

const entry = (over: Partial<BoardEntry> & Pick<BoardEntry, "service" | "projectCode">): BoardEntry => ({
  signal: "delivery",
  colour: "amber",
  label: "UNCONFIRMED",
  detail: null,
  idle: false,
  ...over,
});

const bar = (at: string, colour: Bar["colour"], status: string): Bar => ({ at, colour, status, log: [] });

test("the board reads the newest bar of each strip, rather than querying the ledgers again", () => {
  // There used to be a second reader for this: one query per ledger for the
  // newest row per project, on the server, for every page load — beside the
  // query that built the strips from the same tables. The newest bar IS the
  // newest verdict, so that was the same answer fetched twice, and two surfaces
  // that could disagree about one project.
  const strips = {
    [healthKey("lightning", "AST")]: [
      bar("2026-10-16T09:00:00Z", "green", "SENT"),
      bar("2026-10-16T10:00:00Z", "amber", "UNCONFIRMED"),
    ],
  };

  const [entry] = deliveryEntries(strips, boardSignalFor);
  assert.equal(entry.projectCode, "AST");
  assert.equal(entry.label, "UNCONFIRMED", "the newest attempt, not the first one in the list");
  assert.equal(entry.colour, "amber");
  assert.equal(entry.signal, "delivery", "which is what makes it a different problem from a stale reading");
  assert.equal(entry.detail, "2026-10-16T10:00:00Z");
});

test("noise and wbgt stay off the board, or their project would be counted twice", () => {
  // Their ingestion is already reported from the readings-age check, so taking
  // their newest run bar as well would double-count the project and label a run
  // as something it is not.
  const strips = {
    [healthKey("noise", "ZRA")]: [bar("2026-10-16T10:00:00Z", "red", "failed_config_validation")],
    [healthKey("wbgt", "C991")]: [bar("2026-10-16T10:00:00Z", "amber", "completed_with_issues")],
    [healthKey("lightning", "AST")]: [bar("2026-10-16T10:00:00Z", "amber", "UNCONFIRMED")],
  };

  const entries = deliveryEntries(strips, boardSignalFor);
  assert.deepEqual(entries.map((item) => item.service), ["lightning"]);
  assert.equal(boardSignalFor("noise"), null);
  assert.equal(boardSignalFor("wbgt"), null);
});

test("the run-log services reach the board under their own signal", () => {
  // This used to be decided by "is it a delivery source", which silently kept
  // every run source off the board: a subcon, ailytics, haze or chaser run that
  // ended `completed_with_errors` was red on its card and never reached the
  // estate board — the one place that exists to be looked at first. No readings-
  // age check covers them, so a failed run has to arrive from here or nowhere.
  assert.deepEqual(BOARD_SERVICES.slice().sort(), ["ailytics", "haze", "issueChaser", "lightning", "subcon"]);
  for (const service of ["subcon", "ailytics", "haze", "issueChaser"] as const) {
    assert.equal(boardSignalFor(service), "run", service);
  }
  assert.equal(boardSignalFor("lightning"), "delivery", "lightning has no run log, only a delivery ledger");

  const [entry] = deliveryEntries(
    { [healthKey("subcon", "ZRB")]: [bar("2026-10-17T08:00:00Z", "amber", "completed_with_errors")] },
    boardSignalFor,
  );
  assert.equal(entry.signal, "run");
  assert.equal(entry.colour, "amber");
  assert.equal(entry.label, "completed_with_errors", "the service's own word");
});

test("an empty or unparseable strip key yields no entry rather than a wrong one", () => {
  // The key is `JSON.stringify([service, code])`, and a hand-rolled
  // `service:code` split has already cost one silent lookup failure in this
  // codebase — so the inverse is parsed, and anything that is not a pair is
  // dropped instead of becoming an entry for service "undefined".
  const entries = deliveryEntries(
    {
      [healthKey("haze", "AST")]: [],
      "not-json": [bar("2026-10-16T10:00:00Z", "red", "FAILED")],
      '["haze"]': [bar("2026-10-16T10:00:00Z", "red", "FAILED")],
    },
    () => "delivery",
  );
  assert.deepEqual(entries, []);
});

test("one failure across many projects is one incident, not many problems", () => {
  // The live shape of it: haze's listener stopped confirming recipients, and
  // every project in the estate reported the same word at the same minute.
  const incidents = incidentsFrom([
    entry({ service: "haze", projectCode: "AST", detail: "2026-10-16T10:00:00+00:00" }),
    entry({ service: "haze", projectCode: "C991-SGB", detail: "2026-10-16T11:00:00+00:00" }),
    entry({ service: "haze", projectCode: "TBCA", detail: "2026-10-16T10:00:00+00:00" }),
    entry({ service: "haze", projectCode: "ZRA", colour: "green", label: "SENT" }),
  ]);

  assert.equal(incidents.length, 1, "three projects failing one way is one row");
  assert.deepEqual(incidents[0].projects, ["AST", "C991-SGB", "TBCA"], "sorted, and the healthy project is not listed");
  assert.equal(incidents[0].label, "UNCONFIRMED", "the service's own word survives grouping");
  // A range, not a single key: a run that straddles two hours stays one
  // incident, and "since 10:00" is the fact a reader needs.
  assert.equal(incidents[0].from, "2026-10-16T10:00:00+00:00");
  assert.equal(incidents[0].to, "2026-10-16T11:00:00+00:00");
});

test("two different failures in one service stay two incidents", () => {
  const incidents = incidentsFrom([
    entry({ service: "haze", projectCode: "AST", label: "UNCONFIRMED" }),
    entry({ service: "haze", projectCode: "TBCA", label: "FAILED", colour: "red" }),
    // Same project, same service, different question — two people's problems.
    entry({ service: "haze", projectCode: "AST", signal: "ingestion", label: "no recent data" }),
  ]);

  assert.equal(incidents.length, 3);
  assert.equal(incidents[0].label, "FAILED", "red sorts above amber whatever its blast radius");
});

test("the widest blast radius sorts first among equals", () => {
  // Haze sorts before Noise by name, so the lone failure goes to HAZE: this
  // order can then only come from the blast radius, never from the alphabetical
  // tie-break underneath it.
  const incidents = incidentsFrom([
    entry({ service: "haze", projectCode: "ONE", label: "UNCONFIRMED" }),
    entry({ service: "noise", projectCode: "A", label: "monitor unavailable" }),
    entry({ service: "noise", projectCode: "B", label: "monitor unavailable" }),
    entry({ service: "noise", projectCode: "C", label: "monitor unavailable" }),
  ]);

  assert.equal(incidents[0].service, "noise", "thirty projects failing one way outranks one project failing another");
  assert.equal(incidents[0].projects.length, 3);
  assert.equal(incidents[1].service, "haze");
});

test("delivery and ingestion coexist for one project, and are counted separately", () => {
  const entries = deliveryEntries(
    { [healthKey("haze", "AST")]: [bar("2026-10-16T10:00:00+00:00", "amber", "UNCONFIRMED")] },
    boardSignalFor,
  );

  assert.equal(entries[0].label, "UNCONFIRMED", "unrewritten, so it can be grepped");
  assert.equal(entries[0].idle, false, "a delivery is never inferred to be idle — the service names its own skips");

  // Delivery and ingestion coexist for one project: summarise must count both
  // rather than collapsing them to one verdict per project.
  const summary = summarise([
    ...entries,
    entry({ service: "haze", projectCode: "AST", signal: "ingestion", colour: "red", label: "no recent data" }),
  ]);
  assert.equal(summary.red, 1);
  assert.equal(summary.amber, 1);
  assert.equal(summary.incidents.length, 2);
});

test("the board lists incidents and the project codes inside them", async () => {
  const board = await readFile(resolve("components/DataHealthBoard.tsx"), "utf8");
  const code = board.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(code, /summary\.incidents\.map/, "the list is grouped failures, not one row per project");
  assert.doesNotMatch(code, /summary\.exceptions\.map/, "an ungrouped list reprints one sentence thirty times");
  assert.match(code, /incident\.projects\.map/, "and the affected codes stay visible, not hidden behind a disclosure");
  assert.match(code, /onOpenProject\?\.\(incident\.service, projectCode\)/, "each code still opens its project");
});
