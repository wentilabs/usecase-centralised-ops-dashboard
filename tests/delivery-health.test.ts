import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { deliveryEntries, incidentsFrom, summarise, type BoardEntry } from "../lib/health-board";
import { readDelivery, servicesWithLedger } from "../lib/delivery-reader";

const reply = (body: unknown) => async () => ({ ok: true, body });

const entry = (over: Partial<BoardEntry> & Pick<BoardEntry, "service" | "projectCode">): BoardEntry => ({
  signal: "delivery",
  colour: "amber",
  label: "UNCONFIRMED",
  detail: null,
  idle: false,
  ...over,
});

test("the newest attempt wins, because the ledger holds every attempt ever made", async () => {
  // Newest-first, as the query orders them. AST appears twice: the older row is
  // the one that succeeded, and reporting it would show a green project that is
  // currently failing — the exact direction of error that matters.
  const verdicts = await readDelivery(
    "haze",
    reply([
      { project_code: "AST", delivery_status: "UNCONFIRMED", created_at: "2026-10-16T10:00:00+00:00" },
      { project_code: "C991-SGB", delivery_status: "SENT", created_at: "2026-10-16T10:00:00+00:00" },
      { project_code: "AST", delivery_status: "SENT", created_at: "2026-10-16T09:00:00+00:00" },
    ]),
  );

  assert.equal(verdicts.length, 2, "one verdict per project, not one per attempt");
  const ast = verdicts.find((verdict) => verdict.projectCode === "AST");
  assert.equal(ast?.status, "UNCONFIRMED", "the newest attempt is the verdict");
  assert.equal(ast?.at, "2026-10-16T10:00:00+00:00");
});

test("a delivery status is coloured by the service's own contract, not by this reader", async () => {
  // `UNCONFIRMED` is amber because haze's contract says so. Nothing in HALO
  // decides what haze's words mean — that is the whole point of the contract
  // block, and a reader that classified them here would drift the first time a
  // service added a status.
  const [verdict] = await readDelivery(
    "haze",
    reply([{ project_code: "AST", delivery_status: "UNCONFIRMED", created_at: "2026-10-16T10:00:00+00:00" }]),
  );
  assert.equal(verdict.colour, "amber");

  const [failed] = await readDelivery(
    "lightning",
    reply([{ project_code: "AST", delivery_status: "FAILED", created_at: "2026-10-16T10:00:00+00:00" }]),
  );
  assert.equal(failed.colour, "red");
});

test("a service with no readable ledger yields nothing rather than a green it has not earned", async () => {
  let called = false;
  const verdicts = await readDelivery("wbgt", async () => {
    called = true;
    return { ok: true, body: [] };
  });

  assert.deepEqual(verdicts, [], "no ledger means no verdict");
  assert.equal(called, false, "and no query is attempted against a table that is empty by design");

  // The three with a per-project ledger that is actually written to. The others
  // are absent deliberately — see the omissions note in delivery-reader.ts —
  // and the board reports them as uncovered instead of inventing a verdict.
  assert.deepEqual(servicesWithLedger().sort(), ["haze", "issueChaser", "lightning"]);
});

test("a failed query leaves the project unjudged instead of reporting it healthy", async () => {
  const verdicts = await readDelivery("haze", async () => ({
    ok: false,
    // Deliberately a well-formed row behind a failed status — a stale proxy
    // body, or a partial response. The status has to win, or an outage is
    // reported as a healthy send.
    body: [{ project_code: "AST", delivery_status: "SENT", created_at: "2026-10-16T09:00:00+00:00" }],
  }));
  assert.deepEqual(verdicts, [], "an unreachable ledger is not a clean ledger");
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

test("delivery verdicts become entries that carry the service's own status word", () => {
  const entries = deliveryEntries([
    { service: "haze", projectCode: "AST", colour: "amber", status: "UNCONFIRMED", at: "2026-10-16T10:00:00+00:00" },
  ]);

  assert.equal(entries[0].signal, "delivery", "the signal is what makes this a different problem from a stale reading");
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
