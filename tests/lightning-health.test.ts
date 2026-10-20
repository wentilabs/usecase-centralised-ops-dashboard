import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { noticeEntries, summarise } from "../lib/health-board";
import {
  EVALUATION_STALE_MS,
  FEED_QUIET_MS,
  STOP_GRACE_MS,
  TICK_LATE_MS,
  TICK_STALLED_MS,
  assessFeed,
  assessTick,
  lightningProjectFaults,
  readLightningHealth,
} from "../lib/lightning-health";
import { readProcessWindow } from "../lib/process-log";

/**
 * `/api/lightning-tick` runs every minute, so a check that mirrored it would be a process per
 * minute. These pin the version that is not: a verdict from the three small rows the service already
 * writes on every tick, at the edge of each threshold in the plan. The two failures it exists to
 * catch are silent in a delivery strip — a service that stopped looks exactly like a calm sky, and a
 * project stuck in STOP has no bar to draw.
 */
const MIN = 60_000;
const NOW = new Date("2026-10-20T06:00:00.000Z");
const ago = (minutes: number) => NOW.getTime() - minutes * MIN;
const tick = (minutesAgo: number, extra: Record<string, unknown> = {}) => ({ last_tick_finished_at: ago(minutesAgo), last_tick_status: "COMPLETED", last_tick_projects_total: 28, last_tick_projects_failed: 0, ...extra });

test("the tick is fine inside five minutes, amber from five, red from fifteen", () => {
  assert.equal(assessTick(tick(0.5), NOW), null);
  assert.equal(assessTick(tick(4.9), NOW), null);
  assert.equal(assessTick(tick(5), NOW)?.colour, "amber", "the first missed minutes are amber");
  assert.equal(assessTick(tick(14.9), NOW)?.colour, "amber");
  assert.equal(assessTick(tick(15), NOW)?.colour, "red", "a quarter of an hour blind is red");
  assert.equal(TICK_LATE_MS, 5 * MIN);
  assert.equal(TICK_STALLED_MS, 15 * MIN);

  const stalled = assessTick(tick(22), NOW)!;
  assert.match(stalled.label, /^No tick has finished since .* SGT \(22 min ago\); it runs every minute$/);
  assert.equal(stalled.id, "tick");
  assert.equal(stalled.detail, new Date(ago(22)).toISOString());
});

test("a tick that finished with errors says how many projects failed", () => {
  const notice = assessTick(tick(1, { last_tick_status: "COMPLETED_WITH_ERRORS", last_tick_projects_failed: 3 }), NOW)!;
  assert.equal(notice.colour, "amber");
  assert.match(notice.label, /COMPLETED_WITH_ERRORS with 3 of 28 projects failing/);
  // A whole tick failing is not a partial.
  assert.equal(assessTick(tick(1, { last_tick_status: "FAILED" }), NOW)?.colour, "red");
  // Two ticks overlapping is the lock working, not a fault.
  assert.equal(assessTick(tick(1, { last_tick_status: "SKIPPED_LOCK" }), NOW), null);
});

test("there is no verdict where there is nothing to judge", () => {
  assert.equal(assessTick(null, NOW), null, "no row");
  assert.equal(assessTick({}, NOW), null, "a service that has never ticked is not late");
  assert.equal(assessTick({ last_tick_started_at: ago(30) }, NOW)?.colour, "red", "started and never finished still ages");
});

test("a feed that is behind is stale, dark green, and quotes what NEA said", () => {
  assert.equal(assessFeed({ last_fetch_success_at: ago(1), consecutive_fetch_failures: 0 }, [], NOW), null);
  assert.equal(assessFeed({ last_fetch_success_at: ago(4.9), consecutive_fetch_failures: 0 }, [], NOW), null);
  const late = assessFeed({ last_fetch_success_at: ago(5) }, [], NOW)!;
  assert.equal(late.colour, "stale");
  assert.equal(FEED_QUIET_MS, 5 * MIN);

  const failing = assessFeed({ last_fetch_success_at: ago(2), consecutive_fetch_failures: 3, last_fetch_error: "timeout of 10000ms exceeded" }, [], NOW)!;
  assert.equal(failing.colour, "stale");
  assert.match(failing.label, /last answered 2 min ago, 3 failures in a row — “timeout of 10000ms exceeded”$/);
  assert.match(assessFeed({ last_fetch_success_at: 0, consecutive_fetch_failures: 1 }, [], NOW)!.label, /has not answered, 1 failure in a row/);
});

test("once sites were told the warning service is down, the feed is amber", () => {
  const notice = assessFeed({ last_fetch_success_at: ago(40), consecutive_fetch_failures: 40 }, ["JCU", "TRI"], NOW)!;
  assert.equal(notice.colour, "amber", "from here workers are being told they are not covered");
  assert.match(notice.label, /^Sites were told the warning service is down \(JCU, TRI\); the NEA feed last answered 40 min ago$/);
  assert.match(assessFeed({ last_fetch_success_at: ago(40) }, ["A", "B", "C", "D", "E", "F", "G"], NOW)!.label, /\(A, B, C, D, E and 2 more\)/);
  // A healthy feed is never amber because someone was once degraded: the list is what is true now.
  assert.equal(assessFeed({ last_fetch_success_at: ago(1) }, [], NOW), null);
});

const enabled = new Set(["JCU", "TRI", "SGK"]);
const alive = tick(0.5);

test("a STOP whose all-clear never went is a fault, thirty minutes past its clearance and not before", () => {
  const stop = (minutesPast: number) => ({ project_code: "JCU", last_notified_state: "STOP", active_stop_until_at: ago(minutesPast), last_evaluated_at: ago(0.5) });
  assert.deepEqual(lightningProjectFaults([stop(29.9)], enabled, alive, NOW), {}, "the service may simply be about to send it");
  const faults = lightningProjectFaults([stop(30)], enabled, alive, NOW);
  assert.match(faults.JCU, /^Stuck in STOP: the 20-minute clearance passed at .* SGT but no ALL_CLEAR was sent$/);
  assert.equal(STOP_GRACE_MS, 30 * MIN);
  // WATCH clears silently, so it is not "stuck" by this rule; and a STOP with no known clearance cannot be judged.
  assert.deepEqual(lightningProjectFaults([{ project_code: "JCU", last_notified_state: "WATCH", active_stop_until_at: ago(90), last_evaluated_at: ago(0.5) }], enabled, alive, NOW), {});
  assert.deepEqual(lightningProjectFaults([{ project_code: "JCU", last_notified_state: "STOP", active_stop_until_at: null, last_evaluated_at: ago(0.5) }], enabled, alive, NOW), {});
});

test("a project that stopped being evaluated is a fault, fifteen minutes in and not before", () => {
  const project = (minutes: number) => ({ project_code: "TRI", last_evaluated_at: ago(minutes) });
  assert.deepEqual(lightningProjectFaults([project(14.9)], enabled, alive, NOW), {});
  assert.match(lightningProjectFaults([project(15)], enabled, alive, NOW).TRI, /^Not evaluated since .* SGT \(15 min ago\), although the tick last finished at .* SGT$/);
  assert.equal(EVALUATION_STALE_MS, 15 * MIN);
});

test("a CLEAR project is not stale after its configured working hours", () => {
  const now = new Date("2026-10-20T11:30:00.000Z"); // 19:30 SGT
  const finished = { last_tick_finished_at: now.getTime() - 30_000 };
  const project = { project_code: "TJR", last_notified_state: "CLEAR", last_evaluated_at: Date.parse("2026-10-20T10:59:00.000Z") };
  const config = { project_code: "TJR", enabled: true, working_hours_start_hhmm: "0800", working_hours_end_hhmm: "1900", red_dwell_seconds: 1200 };
  assert.deepEqual(lightningProjectFaults([project], new Set(["TJR"]), finished, now, [config]), {});
});

test("an open Lightning episode remains expected to be evaluated after hours", () => {
  const now = new Date("2026-10-20T11:30:00.000Z"); // 19:30 SGT
  const finished = { last_tick_finished_at: now.getTime() - 30_000 };
  const project = { project_code: "TJR", last_notified_state: "WATCH", last_evaluated_at: Date.parse("2026-10-20T10:59:00.000Z") };
  const config = { project_code: "TJR", enabled: true, working_hours_start_hhmm: "0800", working_hours_end_hhmm: "1900", red_dwell_seconds: 1200 };
  assert.match(lightningProjectFaults([project], new Set(["TJR"]), finished, now, [config]).TJR, /^Not evaluated since/);
});

test("the service's own error wins, and silence is not a fault", () => {
  const faults = lightningProjectFaults(
    [{ project_code: "SGK", last_error: "manpower-sheet POC mentions require manpower_sheet_id", last_notified_state: "STOP", active_stop_until_at: ago(90), last_evaluated_at: ago(60) }],
    enabled, alive, NOW,
  );
  assert.deepEqual(faults, { SGK: "manpower-sheet POC mentions require manpower_sheet_id" }, "its own words, even with a stuck STOP and a stale evaluation behind it");
  // Never evaluated is a disabled or brand-new project, not a stall.
  assert.deepEqual(lightningProjectFaults([{ project_code: "TRI", last_evaluated_at: null }], enabled, alive, NOW), {});
});

test("a disabled project is never a fault, however old its last evaluation", () => {
  const old = [{ project_code: "CRP", last_evaluated_at: ago(600), last_notified_state: "STOP", active_stop_until_at: ago(600) }];
  assert.deepEqual(lightningProjectFaults(old, new Set(["JCU"]), alive, NOW), {});
});

test("when the tick itself has stopped, twenty-eight cards are not painted — the one notice says it", () => {
  const project = { project_code: "JCU", last_evaluated_at: ago(40), last_notified_state: "STOP", active_stop_until_at: ago(90) };
  assert.deepEqual(lightningProjectFaults([project], enabled, tick(40), NOW), {});
  // but a project's own error is still its own
  assert.deepEqual(lightningProjectFaults([{ ...project, last_error: "bad config" }], enabled, tick(40), NOW), { JCU: "bad config" });
});

/** A fake database that answers the three reads and records what was asked. */
function database(rows: { service?: unknown; projects?: unknown; configs?: unknown }, failing: string[] = []) {
  const asked: string[] = [];
  const request = async (path: string, init: { schema: string }) => {
    asked.push(path.split("?")[0]);
    assert.equal(init.schema, "lightning");
    const table = path.split("?")[0];
    if (failing.includes(table)) return { ok: false, body: { message: "boom" } };
    const body = table === "lightning_service_runtime" ? rows.service : table === "lightning_project_runtime" ? rows.projects : rows.configs;
    return { ok: true, body };
  };
  return { request, asked };
}

test("it reads three small tables, once each, and never the per-minute audit", async () => {
  const db = database({
    service: [tick(1, { last_fetch_success_at: ago(1), consecutive_fetch_failures: 0 })],
    projects: [{ project_code: "JCU", last_evaluated_at: ago(0.5), last_notified_state: "CLEAR" }],
    configs: [{ project_code: "JCU", enabled: true }],
  });
  const health = await readLightningHealth(db.request, NOW);
  assert.deepEqual(health, { notices: [], faults: {} });
  assert.deepEqual([...db.asked].sort(), ["lightning_project_config".concat("s"), "lightning_project_runtime", "lightning_service_runtime"]);
  assert.ok(!db.asked.includes("lightning_tick_audit"), "43,000 rows a month, and nothing here needs one");
});

test("it finds a stalled tick, a degraded site and a stuck STOP in one read", async () => {
  const db = database({
    service: [tick(20, { last_fetch_success_at: ago(20) })],
    projects: [
      { project_code: "JCU", last_notified_degraded: true, last_evaluated_at: ago(20) },
      { project_code: "CRP", last_notified_degraded: true, last_evaluated_at: ago(20) },
    ],
    configs: [{ project_code: "JCU", enabled: true }, { project_code: "CRP", enabled: false }],
  });
  const { notices } = await readLightningHealth(db.request, NOW);
  assert.deepEqual(notices.map((n) => [n.id, n.colour]), [["tick", "red"], ["feed", "amber"]]);
  assert.match(notices[1].label, /\(JCU\)/, "a disabled project's old degraded flag is not a site that was told");
});

test("a table that cannot be read says nothing rather than something wrong", async () => {
  for (const failing of [["lightning_service_runtime"], ["lightning_project_runtime"], ["lightning_project_configs"]]) {
    const db = database({ service: [tick(30)], projects: [{ project_code: "JCU", last_evaluated_at: ago(30) }], configs: [{ project_code: "JCU", enabled: true }] }, failing);
    const health = await readLightningHealth(db.request, NOW);
    assert.ok(Array.isArray(health.notices) && typeof health.faults === "object", failing.join());
  }
  const none = await readLightningHealth(database({ service: "not rows", projects: null, configs: undefined }).request, NOW);
  assert.deepEqual(none, { notices: [], faults: {} });
  const thrown = await readLightningHealth(async () => { throw new Error("socket"); }, NOW);
  assert.deepEqual(thrown, { notices: [], faults: {} });
});

test("service-wide notices reach the board as their own entries, never as a project", () => {
  const entries = noticeEntries([
    { id: "tick", colour: "red", label: "No tick has finished since …", detail: "2026-10-20T05:40:00.000Z" },
    { id: "feed", colour: "stale", label: "The NEA feed last answered 6 min ago", detail: null },
  ]);
  assert.deepEqual(entries.map((e) => [e.projectCode, e.signal, e.scope, e.colour]), [["tick", "run", "service", "red"], ["NEA feed", "ingestion", "service", "stale"]]);

  const summary = summarise(entries);
  assert.equal(summary.red, 1);
  assert.equal(summary.stale, 1);
  assert.equal(summary.incidents[0].scope, "service");
  assert.equal(summary.late[0].scope, "service", "the late feed is listed, calmly, in its own section");
  assert.equal(summary.exceptions.length, 1, "and only the tick needs acting on");
});

test("a service-wide chip is not a button, and the page carries the notices", async () => {
  const board = await readFile(resolve("components/DataHealthBoard.tsx"), "utf8");
  assert.equal(board.match(/incident\.scope === "service"/g)?.length, 2, "in both the issues and the late-readings lists");
  assert.match(await readFile(resolve("app/api/project-strips/route.ts"), "utf8"), /listServiceNotices/);
  assert.match(await readFile(resolve("components/DashboardShell.tsx"), "utf8"), /noticeEntries\(serviceNotices\)/);
});

test("every bar says which kind of process it was", async () => {
  const body = [
    { project_code: "JCU", delivery_status: "FAILED", event_type: "ALL_CLEAR", created_at: "2026-10-20T05:00:00Z", last_delivery_error: "timeout" },
    { project_code: "JCU", delivery_status: "SENT", event_type: "KICKOFF", created_at: "2026-10-20T04:00:00Z", last_delivery_error: null },
  ];
  let path = "";
  const lightning = await readProcessWindow("lightning", async (requested) => { path = requested; return { ok: true, body }; }, 100, "2026-10-18T00:00:00Z");
  assert.deepEqual(lightning.map((s) => [s.status, s.kind]), [["FAILED", "ALL_CLEAR"], ["SENT", "KICKOFF"]]);
  assert.match(path, /select=[^&]*event_type/, "asked for the column, not guessed");

  let runPath = "";
  const run = await readProcessWindow("wbgt", async (requested) => { runPath = requested; return { ok: true, body: [{ project_code: "CCCC", status: "completed", started_at: "2026-10-20T05:00:00Z", errors: [], job_type: "wbgt-hourly" }] }; }, 100, "2026-10-18T00:00:00Z");
  assert.equal(run[0].kind, "wbgt-hourly");
  assert.match(runPath, /select=[^&]*job_type/);

  const bars = await readFile(resolve("components/HealthBars.tsx"), "utf8");
  assert.match(bars, /bar\.kind \? `\$\{bar\.kind\} · ` : ""/, "the bar's tooltip");
  assert.match(bars, /\{bar\.kind\}/, "and the modal's row");
});

test("a row with no kind carries none, rather than an empty one", async () => {
  const out = await readProcessWindow("wbgt", async () => ({ ok: true, body: [{ project_code: "CCCC", status: "completed", started_at: "2026-10-20T05:00:00Z", errors: [], job_type: null }] }), 100, "2026-10-18T00:00:00Z");
  assert.equal("kind" in out[0], false);
});
