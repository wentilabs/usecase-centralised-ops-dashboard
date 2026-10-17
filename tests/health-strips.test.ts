import assert from "node:assert/strict";
import test from "node:test";

import {
  BAR_COUNT,
  bySeverity,
  severityOf,
  stripFrom,
  stripsFrom,
  troubleCount,
  troubleIn,
} from "../lib/health-timeline";
import { PROCESS_SERVICES, boardSignalFor, readProcessWindow } from "../lib/process-log";

const sample = (at: string, colour: "green" | "amber" | "red", status: string = colour, log: string[] = []) =>
  ({ at, colour, status, log });

test("a bar is a process, so a slow cadence fills the strip instead of leaving blanks", () => {
  // The reason this is ordinal. Subcon reports twice a day: on an hourly axis
  // its card was ninety-eight grey gaps and two coloured bars, which reads as a
  // broken service rather than a quiet one.
  const twiceDaily = Array.from({ length: BAR_COUNT + 20 }, (_, index) =>
    sample(
      `2026-0${6 + Math.floor(index / 60)}-${String(1 + (Math.floor(index / 2) % 28)).padStart(2, "0")}` +
        `T${index % 2 ? "18" : "06"}:00:00Z`,
      "green",
    ),
  );

  const bars = stripFrom(twiceDaily);
  assert.equal(bars.length, BAR_COUNT, "a hundred processes, however long they took");
  assert.ok(bars.every((bar) => bar.at), "and every one of them is a real event, with a time");
  assert.ok(bars.every((bar) => bar.colour === "green"), "and no blanks among them");
});

test("the newest processes are kept, oldest-first, however the pages arrived", () => {
  // Ordering is this function's job: samples arrive newest-first, concatenated
  // across several pages and two different readers.
  const bars = stripFrom(
    [
      sample("2026-10-16T09:00:00Z", "green"),
      sample("2026-10-16T11:00:00Z", "red"),
      sample("2026-10-16T07:00:00Z", "amber"),
      sample("2026-10-16T10:00:00Z", "green"),
    ],
    3,
  );

  assert.deepEqual(bars.map((bar) => bar.at.slice(11, 13)), ["09", "10", "11"], "oldest first, newest on the right");
  assert.equal(bars.at(-1)?.colour, "red", "the newest process is the rightmost bar");
});

test("each project gets its own strip, and a project with no processes gets none", () => {
  const strips = stripsFrom([
    { key: "A", ...sample("2026-10-16T11:00:00Z", "green") },
    { key: "A", ...sample("2026-10-16T10:00:00Z", "amber") },
    { key: "B", ...sample("2026-10-16T11:00:00Z", "red") },
  ]);

  assert.deepEqual([...strips.keys()].sort(), ["A", "B"]);
  // Fifty blank bars on a card read as a broken system rather than a quiet one.
  assert.equal(strips.get("C"), undefined);
  assert.deepEqual(strips.get("A")?.map((bar) => bar.colour), ["amber", "green"]);
});

test("the expanded view lists only the trouble, newest first, in the service's own words", () => {
  const bars = stripFrom([
    sample("2026-10-16T08:00:00Z", "green", "completed"),
    sample("2026-10-16T09:00:00Z", "amber", "completed_with_issues"),
    sample("2026-10-16T10:00:00Z", "green", "completed"),
    sample("2026-10-16T11:00:00Z", "red", "failed_config_validation"),
  ]);

  const trouble = troubleIn(bars);
  // One row per occurrence, newest first, NOT grouped. Grouping answers "how
  // often", which is the wrong question once somebody has decided to look:
  // what they need is when each happened and what the service said, because
  // that distinguishes one sensor failing all day from a different one each
  // hour. The count is already on the strip that opened the modal.
  assert.deepEqual(trouble.map((bar) => bar.status), ["failed_config_validation", "completed_with_issues"]);
  assert.ok(!trouble.some((bar) => bar.colour === "green"), "a clean process is not an exception");
  assert.equal(troubleCount(bars), 2);
});

test("repeated faults stay separate rows, each with its own time and log", () => {
  const bars = stripFrom([
    sample("2026-10-16T19:58:00Z", "amber", "completed_with_issues", ["WC-55: reading 38 minutes old"]),
    sample("2026-10-16T18:58:00Z", "amber", "completed_with_issues", ["WC-56: reading 33 minutes old"]),
    sample("2026-10-16T17:58:00Z", "green", "completed"),
  ]);

  const trouble = troubleIn(bars);
  assert.equal(trouble.length, 2, "two occurrences, two rows");
  // The whole point of not grouping: these two say the same STATUS and a
  // different thing went wrong each time.
  assert.deepEqual(trouble[0].log, ["WC-55: reading 38 minutes old"]);
  assert.deepEqual(trouble[1].log, ["WC-56: reading 33 minutes old"]);
  assert.equal(trouble[0].at, "2026-10-16T19:58:00Z", "newest first");
});

test("a source is bounded per project rather than by time, and carries the service's own status", async () => {
  let path = "";
  // Lightning has no run log, only a delivery ledger, so this reads one directly.
  const delivered = await readProcessWindow(
    "lightning",
    async (requested) => {
      path = requested;
      return {
        ok: true,
        body: [{
          project_code: "JCU",
          delivery_status: "UNCONFIRMED",
          created_at: "2026-10-16T11:00:39+00:00",
          last_delivery_error: "Listener response did not confirm the requested recipient",
        }],
      };
    },
    100,
    "2026-10-14T11:00:00.000Z",
  );

  // A count AND a floor. The count is what makes the strip ordinal; the floor is
  // what lets the time index bound the keyset walk, and it changes what a short
  // strip means — "this is all that ran in two days" rather than "this is all we
  // fetched".
  assert.match(path, /created_at=gte\.2026-10-14T11:00:00\.000Z/, "bounded by the window floor");
  assert.ok(!path.includes("offset="), "and cut by a keyset, never a row offset");
  assert.match(path, /order=created_at\.desc/, "newest first, so the quota is the newest");
  assert.match(path, /limit=1000/, "a full page, since the server caps at 1000 whatever is asked");
  assert.equal(delivered[0].status, "UNCONFIRMED", "kept verbatim, for the modal and for grepping");
  assert.match(path, /last_delivery_error/, "and the service's own reason comes with it");
  assert.deepEqual(delivered[0].log, ["Listener response did not confirm the requested recipient"]);
  assert.equal(delivered[0].colour, "amber", "coloured by lightning's own contract");

  const ran = await readProcessWindow(
    "wbgt",
    async () => ({
      ok: true,
      body: [
        {
          project_code: "C991",
          status: "completed_with_issues",
          started_at: "2026-10-16T09:00:00+00:00",
          // An array, one entry per affected sensor — the shape WBGT and Noise
          // actually write, and the reason logs are kept as a list.
          errors: ["WC-55: reading 38 minutes old", "WC-56: reading 33 minutes old"],
        },
        { project_code: "", status: "completed", started_at: "2026-10-16T09:00:00+00:00", errors: null },
      ],
    }),
    100,
    "2026-10-14T11:00:00.000Z",
  );

  assert.equal(ran.length, 1, "a row with no project code belongs to no strip");
  assert.equal(ran[0].status, "completed_with_issues");
  assert.deepEqual(ran[0].log, ["WC-55: reading 38 minutes old", "WC-56: reading 33 minutes old"]);
  assert.equal(ran[0].colour, "amber", "completed_with_ is the in-between state, not a pass");
});

test("which services read a run log, which a delivery ledger, and which are not tracked", () => {
  // Haze's NEA scrape is one public feed for the whole estate, so a failed fetch
  // is the same fact about every project and is NOT tracked. What IS tracked is
  // the per-project hourly send job, which is a different thing — it is how an
  // hour whose correct action was to send nothing becomes visible at all.
  assert.deepEqual(
    PROCESS_SERVICES.slice().sort(),
    ["ailytics", "haze", "issueChaser", "lightning", "noise", "subcon", "wbgt"],
  );
  for (const service of ["haze", "issueChaser", "subcon", "ailytics", "noise", "wbgt"] as const) {
    // `signal` is the PRIMARY source's; board membership is a separate question.
    assert.ok(PROCESS_SERVICES.includes(service), service);
  }
  // Lightning's source is a delivery ledger: it has no run log, and its tick
  // audit is estate-wide so it is deliberately not read.
  assert.equal(boardSignalFor("lightning"), "delivery");
});

test("a run log is read first, and the delivery ledger only while its table does not exist", async () => {
  const asked: string[] = [];
  const row = (extra: Record<string, unknown>) => ({ project_code: "AST", ...extra });
  const missing = (table: string) => async (path: string) => {
    asked.push(path.split("?")[0]);
    if (path.startsWith(`${table}?`)) return { ok: false, body: { message: "Could not find the table" } };
    return {
      ok: true,
      body: [row({ delivery_status: "SENT", created_at: "2026-10-16T09:00:00+00:00", last_error: null })],
    };
  };

  // Not created yet — which is where every new run log starts. HALO must not
  // blank the strip in the meantime: the ledger that already has data is read.
  const fallen = await readProcessWindow("haze", missing("haze_job_runs"), 100, "2026-10-14T00:00:00.000Z");
  assert.deepEqual(fallen.map((sample) => sample.status), ["SENT"]);
  assert.ok(asked.includes("haze_notification_events"));

  // Once the table exists, the run log wins outright.
  asked.length = 0;
  const primary = await readProcessWindow(
    "haze",
    async (path: string) => {
      asked.push(path.split("?")[0]);
      return { ok: true, body: [row({ status: "skipped_outside_working_hours", started_at: "2026-10-16T14:00:00+00:00", errors: [] })] };
    },
    100,
    "2026-10-14T00:00:00.000Z",
  );
  assert.deepEqual(primary.map((sample) => sample.status), ["skipped_outside_working_hours"]);
  assert.ok(!asked.includes("haze_notification_events"), "the ledger is not consulted once the run log exists");
});

test("an EMPTY run log does not fall back, because a silent cron is the thing it exists to show", async () => {
  // A service whose cron has stopped firing has a readable but empty run log.
  // Falling back to older delivery rows would show green bars for a service that
  // has gone quiet — hiding exactly the failure the run log was built to expose.
  const asked: string[] = [];
  const result = await readProcessWindow(
    "haze",
    async (path: string) => {
      asked.push(path.split("?")[0]);
      return { ok: true, body: [] };
    },
    100,
    "2026-10-14T00:00:00.000Z",
  );

  assert.deepEqual(result, []);
  assert.ok(!asked.includes("haze_notification_events"), "readable but empty means nothing happened, not 'look elsewhere'");
});

test("Lightning shows current failed recipient errors without changing their wording", async () => {
  let path = "";
  const rows = await readProcessWindow("lightning", async (requested) => {
    path = requested;
    return { ok: true, body: [{
      project_code: "AST", delivery_status: "PARTIAL", created_at: "2026-10-17T10:00:00Z",
      last_delivery_error: null,
      delivery_attempts: [
        { target: "one", delivery_status: "FAILED", last_error: "Listener rejected recipient one" },
        { target: "one", delivery_status: "SENT", last_error: null },
        { target: "two", delivery_status: "FAILED", last_error: "Listener rejected recipient two" },
        { target: "three", delivery_status: "QUEUED", last_error: null },
      ],
    }] };
  }, 100, "2026-10-15T10:00:00Z");

  assert.match(path, /delivery_attempts/, "the existing per-target audit is read");
  assert.equal(rows[0].colour, "amber");
  assert.deepEqual(rows[0].log, ["Listener rejected recipient two"]);
});

test("Lightning keeps the parent error and tolerates old rows without attempts", async () => {
  const rows = await readProcessWindow("lightning", async () => ({ ok: true, body: [
    { project_code: "AST", delivery_status: "FAILED", created_at: "2026-10-17T10:00:00Z", last_delivery_error: "Original failure", delivery_attempts: null },
  ] }), 100, "2026-10-15T10:00:00Z");
  assert.deepEqual(rows[0].log, ["Original failure"]);
});

test("each covered service maps its stored error field to HALO without rewriting text", async () => {
  // Haze and chaser have TWO sources — the run log, and the delivery ledger read
  // only while the run log's table does not exist — and each must be right.
  // `unreadable` names a table to report as missing, which is how the ledger path
  // is reached.
  const cases = [
    { service: "noise", status: "failed", time: "started_at", error: "errors", value: ["Noise source timed out"] },
    { service: "wbgt", status: "failed", time: "started_at", error: "errors", value: ["WBGT sheet unavailable"] },
    { service: "subcon", status: "failed_unhandled_error", time: "started_at", error: "errors", value: ["Report build failed"] },
    { service: "ailytics", status: "failed", time: "started_at", error: "errors", value: ["Summary build failed"] },
    { service: "haze", status: "failed", time: "started_at", error: "errors", value: ["bad@g.us: Haze listener rejected"] },
    { service: "issueChaser", status: "failed", time: "started_at", error: "errors", value: ["Chaser listener rejected"] },
    // The ledgers, while the run logs are not created yet.
    { service: "haze", status: "FAILED", time: "created_at", error: "last_error", value: "Haze listener rejected", unreadable: "haze_job_runs" },
    { service: "issueChaser", status: "failed", time: "submitted_at", error: "error", value: "Chaser listener rejected", unreadable: "job_runs" },
  ] as const;

  for (const entry of cases) {
    let path = "";
    const label = `${entry.service}${"unreadable" in entry ? " (ledger fallback)" : ""}`;
    const rows = await readProcessWindow(entry.service, async (requested) => {
      if ("unreadable" in entry && requested.startsWith(`${entry.unreadable}?`)) {
        return { ok: false, body: { message: "Could not find the table" } };
      }
      path = requested;
      return { ok: true, body: [{ project_code: "AST", status: entry.status,
        delivery_status: entry.status, [entry.time]: "2026-10-17T10:00:00Z", [entry.error]: entry.value }] };
    }, 100, "2026-10-15T10:00:00Z");
    assert.match(path, new RegExp(entry.error), `${label} reads its actual error column`);
    assert.deepEqual(rows[0].log, Array.isArray(entry.value) ? entry.value : [entry.value], label);
  }
});

test("the strip reports what to look at, never a score", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const bars = await readFile(resolve("components/HealthBars.tsx"), "utf8");
  const code = bars.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // A percentage answers "how available were we", which is a status-page
  // question and not this estate's: "48 % clean" invites "is that bad?", which
  // nobody can answer without knowing the service. The faults themselves always
  // say what to do.
  assert.doesNotMatch(code, /%|uptime|shareText|healthyShare/i, "no score on the strip");
  assert.match(code, /to look at/, "the count of what needs attention takes its place");
  assert.match(code, /nothing to action/, "and a clean strip says so without claiming a figure");
});

test("a sample with no timestamp is dropped rather than crashing the card", () => {
  // Not hypothetical. These bars used to be hourly buckets keyed `hour`, with no
  // `at` at all, and the five-minute cache went on serving those objects after
  // the shape changed — `formatSgt(undefined).replace` took the card down. The
  // readers drop these, so this guards the cache outliving a shape change.
  const bars = stripFrom([
    { at: "2026-10-16T11:00:00Z", colour: "green", status: "completed", log: [] },
    { colour: "amber", status: "stale", log: [] } as never,
    { at: "", colour: "red", status: "blank", log: [] },
  ]);

  assert.equal(bars.length, 1, "only the sample that can be ordered and labelled");
  assert.equal(bars[0].status, "completed");
});

test("a short strip is padded to a full width, and the padding is never counted", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const source = await readFile(resolve("components/HealthBars.tsx"), "utf8");

  // Drawn so the newest process sits at the same place on every card, which is
  // what makes two strips comparable at a glance.
  assert.match(source, /BAR_COUNT - bars\.length/, "the empty slots are filled");
  assert.match(source, /bg-muted-foreground\/15/, "faintly, so they read as absent rather than as a state");

  // Counted nowhere. The padding is not a process and must not reach the
  // trouble count, the modal, or the label — a strip of 81 real processes says
  // 81, not 100.
  const bars = stripFrom([
    sample("2026-10-16T11:00:00Z", "amber", "completed_with_issues"),
    sample("2026-10-16T10:00:00Z", "green", "completed"),
  ]);
  assert.equal(bars.length, 2, "the data stays the real processes");
  assert.equal(troubleCount(bars), 1);
  assert.equal(troubleIn(bars).length, 1, "and the modal lists only what happened");
});

test("a project with no processes still gets a full strip of empty slots", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const source = await readFile(resolve("components/HealthBars.tsx"), "utf8");

  // It used to render nothing at all, and the card said "nothing reads this
  // service yet" instead. A hundred grey columns is the better statement: it is
  // precise about the window, and it is the same shape as every other card, so
  // an idle project sits beside a failing one and the two are comparable.
  assert.doesNotMatch(source, /if \(!bars\.length\) return null/, "an empty strip is still drawn");
  assert.match(source, /no activity/, "and labelled as no activity rather than as health");
  assert.match(source, /No processes for \$\{projectCode\} in the last 48 hours/, "said for a screen reader too");
});

test("the strip is tappable on a phone, and an idle one does not block the card", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const [bars, card] = await Promise.all([
    readFile(resolve("components/HealthBars.tsx"), "utf8"),
    readFile(resolve("components/ProjectCard.tsx"), "utf8"),
  ]);

  // The card covers itself with a full-bleed tap overlay on mobile so the whole
  // card opens the editor. At z-20 it swallowed every tap inside the card, so
  // the strip was visible on a phone and completely unopenable.
  assert.match(card, /absolute inset-0 z-20/, "the overlay this has to clear");
  // On the SECTION, not the strip: `relative` there makes it the enclosing
  // stacking context, so a z-index on the strip is only ever compared with its
  // own siblings and never with the overlay. Learned by watching the card open
  // instead of the modal.
  const row = await readFile(resolve("components/DataHealthRow.tsx"), "utf8");
  assert.match(row, /pointer-events-none relative z-30/, "the section clears the overlay");
  assert.match(bars, /pointer-events-auto/, "and only the strip takes a tap back");

  // And gives the overlay back when there is nothing to open: a disabled button
  // still hit-tests, so it would punch a dead hole in the card's tap target.
  assert.match(bars, /disabled:pointer-events-none/);
  assert.match(bars, /h-7 items-stretch gap-px md:h-5/, "and is thumb-sized on a phone");
});

test("one red outranks any number of ambers, however many", () => {
  const strip = (red: number, amber: number) =>
    severityOf([
      ...Array.from({ length: red }, (_, i) => sample(`2026-10-16T0${i % 10}:00:00Z`, "red", "failed")),
      ...Array.from({ length: amber }, (_, i) => sample(`2026-10-15T0${i % 10}:00:00Z`, "amber", "degraded")),
      sample("2026-10-16T11:00:00Z", "green", "completed"),
    ]);

  // Lexicographic, not weighted. A chronic tolerated amber — a project logging
  // `completed_with_issues` on every run — must not bury one hard failure, and
  // a weighted score would eventually be tuned until it did, because the amber
  // counts are an order of magnitude larger.
  assert.ok(bySeverity(strip(1, 0), strip(0, 99)) < 0, "a single red leads 99 ambers");
  assert.ok(bySeverity(strip(2, 0), strip(1, 50)) < 0, "and more reds still lead");

  // Within the same red count, the ambers break the tie.
  assert.ok(bySeverity(strip(1, 9), strip(1, 2)) < 0);
  assert.equal(bySeverity(strip(0, 0), strip(0, 0)), 0, "two clean projects keep their existing order");

  assert.deepEqual(strip(3, 4), { red: 3, amber: 4, green: 1 }, "greens are counted separately, not as trouble");
  assert.deepEqual(severityOf(undefined), { red: 0, amber: 0, green: 0 }, "a project with no strip is not a problem");
});

test("among clean projects, the busiest leads and the barely-run sink", () => {
  const clean = (green: number) => ({ red: 0, amber: 0, green });

  // A card showing a hundred clean runs is more informative than one showing
  // two, and sinking the quiet ones keeps a project that has barely run where
  // it can be noticed rather than scattered through the healthy majority.
  assert.ok(bySeverity(clean(100), clean(2)) < 0);
  assert.equal(bySeverity(clean(7), clean(7)), 0, "a true tie keeps the existing order");

  // Green never outranks trouble, however much of it there is.
  assert.ok(bySeverity({ red: 0, amber: 1, green: 0 }, clean(100)) < 0, "one amber still leads a perfect strip");
  assert.ok(bySeverity({ red: 1, amber: 0, green: 0 }, { red: 0, amber: 99, green: 0 }) < 0);
});

test("the card list is ordered by severity before anything else", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const shell = await readFile(resolve("components/DashboardShell.tsx"), "utf8");

  assert.match(shell, /const severity = bySeverity\(/, "severity decides first");
  assert.match(shell, /if \(severity\) return severity;/);
  // And only then the pre-existing order, which still decides every healthy card.
  assert.ok(
    shell.indexOf("const severity = bySeverity(") < shell.indexOf("const rank = emphasisRank("),
    "emphasis is the tie-break, not the other way round",
  );
  assert.match(shell, /\}, \[rows, active, query, projectStrips, projectFaults\]\);/, "and it re-sorts when the strips or the faults arrive");
});
