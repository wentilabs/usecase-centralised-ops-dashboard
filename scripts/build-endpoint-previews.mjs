import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds lib/endpoint-samples.generated.ts: the real message behind each endpoint
 * that delivers one and has no formatter column to explain it.
 *
 * Nothing here is written from memory, and nothing is read from a sibling's working
 * tree — those go stale or carry another session's uncommitted edits. Every source is
 * the service's `origin/main`:
 *
 *  - `lift(...)`  copies a fenced block out of a service's own message document.
 *  - `run(...)`   executes that service's own message builder against a fixture the
 *                 service's own tests already use, and records what it returned.
 *
 * Both fail the build when the thing they point at has moved, rather than emitting a
 * plausible-looking sample from an older shape. Run it after a service's message
 * shapes change:
 *
 *     node scripts/build-endpoint-previews.mjs
 *
 * `SERVICE_REPOSITORY_ROOT` overrides the folder holding the sibling checkouts and
 * `ENDPOINT_PREVIEWS_OUT` the output path (the freshness test writes to a temp file).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblings = process.env.SERVICE_REPOSITORY_ROOT || path.dirname(root);
const scratch = mkdtempSync(path.join(tmpdir(), "endpoint-previews-"));

const git = (repo, ...args) =>
  execFileSync("git", ["-C", path.join(siblings, repo), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const snapshots = new Map();
/** A clean copy of `origin/main` for a repo, with the checkout's node_modules alongside. */
function snapshot(repo) {
  if (snapshots.has(repo)) return snapshots.get(repo);
  const dir = path.join(scratch, repo);
  execFileSync("mkdir", ["-p", dir]);
  const archive = execFileSync("git", ["-C", path.join(siblings, repo), "archive", "origin/main"], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  const modules = path.join(siblings, repo, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, path.join(dir, "node_modules"));
  snapshots.set(repo, dir);
  return dir;
}

const documents = new Map();
const documentOf = (repo, file) => {
  const key = `${repo}:${file}`;
  if (!documents.has(key)) documents.set(key, git(repo, "show", `origin/main:${file}`));
  return documents.get(key);
};

/** The nth fenced block after the first line matching `anchor`. */
function lift(repo, file, anchor, nth = 0) {
  const markdown = documentOf(repo, file);
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => anchor.test(line));
  if (start < 0) throw new Error(`${repo}/${file}: no line matches ${anchor} — the document has moved; update scripts/build-endpoint-previews.mjs`);
  let seen = -1;
  for (let index = start; index < lines.length; index += 1) {
    if (!/^```/.test(lines[index])) continue;
    const open = index;
    index += 1;
    while (index < lines.length && !/^```/.test(lines[index])) index += 1;
    seen += 1;
    if (seen === nth) return lines.slice(open + 1, index).join("\n");
  }
  throw new Error(`${repo}/${file}: fewer than ${nth + 1} fenced blocks after ${anchor}`);
}

const require = createRequire(import.meta.url);
/** Require a module from a repo's origin/main snapshot. */
const load = (repo, file) => require(path.join(snapshot(repo), file));

const fill = (text, values) => Object.entries(values).reduce((out, [token, value]) => out.split(token).join(value), text);

const samples = {};
const add = (id, { caption = null, text, source }) => {
  if (!text || !text.trim()) throw new Error(`${id}: produced an empty sample`);
  (samples[id] ||= { bubbles: [], source }).bubbles.push({ caption, text });
};

try {
  // ── Noise ────────────────────────────────────────────────────────────────
  const noiseDoc = "MESSAGE_SHAPES.md";
  const noiseRepo = "usecase-wohhup-noise-meter-alerts";
  add("noise.fifteen-minute-average", {
    text: lift(noiseRepo, noiseDoc, /The 15-minute average exceedance endpoint/),
    source: "noise MESSAGE_SHAPES.md, 15-minute average exceedance",
  });
  add("noise.sunday-leq12hr", {
    text: fill(lift(noiseRepo, noiseDoc, /^## 18\. Sunday Daytime Leq12hr/), { PROJECT_CODE: "ZRA" }),
    source: "noise MESSAGE_SHAPES.md §18",
  });
  add("noise.data-health", {
    text: fill(lift(noiseRepo, noiseDoc, /^## Data Health Reminder/), {
      "{{project_code}}": "ZRA",
      "{{service}}": "Noise",
      "{{status}}": "No recent data",
      "{{latest_receipt}}": "28 Sept, 15:14 SGT",
    }),
    source: "noise MESSAGE_SHAPES.md, Data Health Reminder (placeholders filled with the values WBGT's own example uses)",
  });

  // ── WBGT ─────────────────────────────────────────────────────────────────
  const wbgtRepo = "usecase-wohhup-wbgt-alerts";
  add("wbgt.data-health", {
    text: lift(wbgtRepo, "MESSAGE_SHAPES.md", /^## Data Health Reminders/),
    source: "wbgt MESSAGE_SHAPES.md, Data Health Reminders",
  });
  add("wbgt.water-parade-reminder", {
    text: lift(wbgtRepo, "docs/WATER_PARADE_INTEGRATION.md", /The reminder uses this shape:/),
    source: "wbgt docs/WATER_PARADE_INTEGRATION.md, water-parade-reminder",
  });
  {
    // The fixture is the one test/water-parade-daily-summary.test.js builds.
    const { buildDailySummaryMessage } = load(wbgtRepo, "usecases/water-parade/daily-summary.js");
    const roster = [
      { key: "teamtech::row::alice", displayName: "Teamtech", picName: "Alice" },
      { key: "teamtech::row::bob", displayName: "Teamtech", picName: "Bob" },
      { key: "active fire", displayName: "Active Fire", picName: "Carol" },
    ];
    const cycles = [14, 17].map((hour) => ({ id: `cycle-${hour}`, cycle_date: "2026-09-16", wbgt_hour: hour, roster }));
    const events = [
      { cycle_id: "cycle-14", company_key: "active fire", status: "confirmed", source_timestamp: "2026-09-16T14:30:00+08:00" },
      { cycle_id: "cycle-17", company_key: "teamtech::row::alice", status: "confirmed", source_timestamp: "2026-09-16T18:01:00+08:00" },
    ];
    add("wbgt.water-parade-summary", {
      caption: "Missed timings shown (include_missed_timings_wp = true)",
      text: buildDailySummaryMessage({ projectCode: "MBS", date: "2026-09-16", cycles, roster, events }).message,
      source: "wbgt usecases/water-parade/daily-summary.js buildDailySummaryMessage, run on its own test fixture",
    });
    add("wbgt.water-parade-summary", {
      caption: "Counts only (include_missed_timings_wp = false)",
      text: buildDailySummaryMessage({ projectCode: "MBS", date: "2026-09-16", cycles, roster, events, includeMissedTimings: false }).message,
      source: "wbgt usecases/water-parade/daily-summary.js buildDailySummaryMessage, run on its own test fixture",
    });
  }

  // ── Lightning ────────────────────────────────────────────────────────────
  const lightningRepo = "usecase-lightning-alerts";
  const lightningDoc = "MESSAGE_SHAPES.md";
  add("lightning.kickoff", {
    text: lift(lightningRepo, lightningDoc, /^## 0\. `KICKOFF`/),
    source: "lightning MESSAGE_SHAPES.md §0",
  });
  for (const [anchor, caption] of [
    [/^## 1\. `RED`/, "Red — CLEAR → STOP"],
    [/^## 2\. `AMBER`/, "Amber — CLEAR → WATCH (only when amber_enabled)"],
    [/^## 3\. `ALL_CLEAR`/, "All-clear — STOP → CLEAR"],
    [/^## 4\. `DEGRADED_ENTER`/, "Degraded — the warning feed is down"],
  ]) {
    add("lightning.tick", { caption, text: lift(lightningRepo, lightningDoc, anchor), source: "lightning MESSAGE_SHAPES.md §1–§4 (renderAlert output)" });
  }

  // ── Haze ─────────────────────────────────────────────────────────────────
  {
    const { buildKickoffMessage } = load("usecase-haze-alerts", "lib/haze-messages.js");
    add("haze.kickoff", {
      text: buildKickoffMessage({ psi24h: 75 }).message,
      source: "haze lib/haze-messages.js buildKickoffMessage, run on the PSI the repo's own test uses",
    });
  }

  // ── Subcon ───────────────────────────────────────────────────────────────
  const subconRepo = "usecase-subcon-manpower-activities";
  {
    const { buildManpowerSummaryMessage } = load(subconRepo, "usecases/activity/manpower-summary.js");
    // One fixture, both `manpower_summary_format` options, so the only difference
    // on screen is the one the setting makes. Day and Night, with machines on one
    // company, taken from the service's own test/manpower-summary.test.js.
    const manpower = [
      { Date: "2026-08-31", Company: "ABC Builders", Shift: "Day", TotalWorkers: "8" },
      { Date: "2026-08-31", Company: "ABC Builders", Shift: "Day", TotalWorkers: "2" },
      { Date: "2026-08-31", Company: "XYZ Engineering", Shift: "Night", TotalWorkers: "4" },
    ];
    const machines = [{ Date: "2026-08-31", Company: "ABC Builders", Shift: "Day", TotalMachines: "1" }];
    for (const format of ["manpower+machine", "manpower-only"]) {
      add(`subcon.manpower-summary.${format}`, {
        text: buildManpowerSummaryMessage("2026-08-31", manpower, machines, format),
        source: `subcon usecases/activity/manpower-summary.js buildManpowerSummaryMessage (${format}), run on its own test fixture`,
      });
    }

    const { selectActivityRecords, buildDailySummary } = load(subconRepo, "usecases/activity/summary.js");
    const headers = ["Date", "Company", "Location", "Total", "Activity", "Details", "Shift", "Sender", "Timestamp", "Group", "Raw Mesage", "MessageId"];
    const selection = selectActivityRecords([
      headers,
      [46245, "KKL", "B3", 10, "B3 soil excavation and soil disposal work.", "{}", "Day", "KABUAT", 46245.34583, "ZRB", "", "A56D"],
      [46245, "Foundation Alliance", "B3", 10, "Pile head hacking work gash cating and house keeping", "{}", "Day", "Ali Asgor", 46245.35139, "ZRB", "", "AC70"],
      [46245, "", "", "", "", "{}", "Day", "Sender", "11-Aug-2026 08:40", "ZRB", "Company: Recovered Co\nLocation: B2\nActivity: Lifting works\nManpower: 7", "RECOVERED"],
    ], { date: "2026-08-11" });
    add("subcon.activity-summary", {
      text: buildDailySummary(selection.records, selection.date),
      source: "subcon usecases/activity/summary.js buildDailySummary, run on rows from its own test/activity.test.js",
    });

    const { buildHousekeepingReport } = load(subconRepo, "usecases/housekeeping/report.js");
    add("subcon.housekeeping-report", {
      caption: "Someone has not submitted",
      text: buildHousekeepingReport("2026-08-17", [
        { displayName: "ABC Builders", submitted: true },
        { displayName: "XYZ Engineering", picPhone: "6581234567", submitted: false },
      ]),
      source: "subcon usecases/housekeeping/report.js buildHousekeepingReport, run on its own test fixture",
    });
    add("subcon.housekeeping-report", {
      caption: "Everyone has submitted",
      text: buildHousekeepingReport("2026-08-17", [
        { displayName: "ABC Builders", submitted: true },
        { displayName: "XYZ Engineering", submitted: true },
      ]),
      source: "subcon usecases/housekeeping/report.js buildHousekeepingReport, run on its own test fixture",
    });
    add("subcon.housekeeping-report", {
      caption: "Everyone submitted or was excused",
      text: buildHousekeepingReport("2026-08-17", [
        { displayName: "ABC Builders", submitted: true },
        { displayName: "Promatrix", picPhone: "6581234567", submitted: false, excused: true },
      ]),
      source: "subcon usecases/housekeeping/report.js buildHousekeepingReport, run on its own test fixture",
    });
  }

  // ── Ailytics ─────────────────────────────────────────────────────────────
  const ailyticsRepo = "mdw-lambda-ailytics";
  {
    const { buildStatusSummaryMessage } = load(ailyticsRepo, "usecases/ailytics_status_summary/index.js");
    add("ailytics.status-summary", {
      text: buildStatusSummaryMessage({ projectCode: "TEST", date: "2026-09-17", pending: 12, nonCompliant: 5, totalPending: 201, totalNonCompliant: 153 }),
      source: "ailytics usecases/ailytics_status_summary buildStatusSummaryMessage, run on illustrative counts",
    });
    const { buildYesterdaySummaryMessage } = load(ailyticsRepo, "usecases/ailytics_yesterday_summary/index.js");
    add("ailytics.yesterday-summary", {
      text: buildYesterdaySummaryMessage({ projectCode: "TEST", date: "2026-09-17", pending: 201, compliant: 4, nonCompliant: 153 }),
      source: "ailytics usecases/ailytics_yesterday_summary buildYesterdaySummaryMessage, run on the counts its own test uses",
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const output = [
  "// GENERATED FILE — do not edit by hand.",
  "//",
  "// Produced by scripts/build-endpoint-previews.mjs from each service's origin/main:",
  "// fenced blocks lifted from its own message documents, and the output of its own",
  "// message builders. Regenerate after a service's message shapes change:",
  "//",
  "//     node scripts/build-endpoint-previews.mjs",
  "",
  'import type { PreviewBubble } from "./message-previews";',
  "",
  "export const ENDPOINT_SAMPLES: Record<string, { bubbles: PreviewBubble[]; source: string }> = " +
    `${JSON.stringify(samples, null, 2)};`,
  "",
].join("\n");
writeFileSync(process.env.ENDPOINT_PREVIEWS_OUT || path.join(root, "lib/endpoint-samples.generated.ts"), output);
console.log(`wrote ${Object.keys(samples).length} endpoint samples`);
