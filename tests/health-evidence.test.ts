import assert from "node:assert/strict";
import test from "node:test";

import { assessIngestionHealth, describeAge, describeHours, healthKey, healthTarget } from "../lib/data-health";
import { activityFor } from "../lib/data-health-activity";
import { listProjectHealth } from "../lib/data-health-reader";
import type { ProjectConfigRow } from "../lib/services";

/**
 * CCCC went red on a Sunday with "no recent data" and nothing else.
 *
 * Its site hours are 08:00–19:00, it mutes Sundays, and its sensor reports on
 * working days only: last reading Saturday 17:54, none all Sunday. The age check
 * knew the table was old and nothing about why that was expected — or, on a day it
 * was not expected, what the service had said about it. A red with no evidence is
 * a red people learn to ignore, so these pin the two halves of the fix:
 *
 *   - the calendar the project declares is part of what is expected, and
 *   - every amber/red says what was expected, what was seen, and what the service
 *     itself reported — in its own words.
 */
const CCCC = {
  project_code: "CCCC",
  enabled: true,
  enable_hourly: true,
  whatsapp_group_id: "120363000000000000@g.us",
  site_hours_start: 8,
  site_hours_end: 19,
  remove_sunday_notifications: true,
} as unknown as ProjectConfigRow;

const SATURDAY_LAST = "2026-10-17T09:54:00.000Z"; // Sat 17:54 SGT
const target = healthTarget("wbgt", "CCCC")!;
const reading = (createdAt: string) => ({ kind: "row" as const, createdAt, sourceEventAt: null });

const SUNDAY_NOON = new Date("2026-10-18T04:00:00.000Z"); //  Sun 12:00 SGT
const MONDAY_0830 = new Date("2026-10-19T00:30:00.000Z"); //  Mon 08:30 SGT
const MONDAY_1030 = new Date("2026-10-19T02:30:00.000Z"); //  Mon 10:30 SGT

test("a muted Sunday with a silent table is idle, not a fault", () => {
  const activity = activityFor("wbgt", CCCC, SUNDAY_NOON);
  assert.equal(activity.state === "active" && activity.mutedDay, "Sunday");

  const verdict = assessIngestionHealth(target, reading(SATURDAY_LAST), SUNDAY_NOON, activity);
  assert.equal(verdict.tone, "neutral");
  assert.equal(verdict.label, "Data: idle — Sunday is muted");
  assert.equal(verdict.newestReceivedAt, new Date(SATURDAY_LAST).toISOString(), "still says when data last arrived");
});

test("a muted day does not hide a site that DOES report on it", () => {
  // The mute decides whether silence is a finding; it never turns data off. A
  // fresh Sunday reading is green, so a site that reports on its muted day and then
  // stops is still caught the moment it goes quiet outside a mute.
  const activity = activityFor("wbgt", CCCC, SUNDAY_NOON);
  const fresh = assessIngestionHealth(target, reading("2026-10-18T03:40:00.000Z"), SUNDAY_NOON, activity);
  assert.equal(fresh.tone, "good");
});

test("the mute only applies when the project declares it", () => {
  const unmuted = { ...CCCC, remove_sunday_notifications: false } as unknown as ProjectConfigRow;
  const activity = activityFor("wbgt", unmuted, SUNDAY_NOON);
  assert.equal(activity.state === "active" && activity.mutedDay, undefined);
  assert.equal(assessIngestionHealth(target, reading(SATURDAY_LAST), SUNDAY_NOON, activity).tone, "stale");
});

test("Monday morning compares against Saturday, not against a Sunday nobody works", () => {
  // Measured: with the previous active hour taken as 19:00 the night before — a
  // Sunday — the tolerance at Monday 08:00 was 14 h, the reading was 38 h old, and
  // every Monday-muted project was red until its first reading landed.
  const activity = activityFor("wbgt", CCCC, MONDAY_0830);
  assert.equal(activity.state, "active");
  assert.equal(assessIngestionHealth(target, reading(SATURDAY_LAST), MONDAY_0830, activity).tone, "good");
});

test("and a site that really has gone quiet on a working day still goes red", () => {
  const activity = activityFor("wbgt", CCCC, MONDAY_1030);
  const verdict = assessIngestionHealth(target, reading(SATURDAY_LAST), MONDAY_1030, activity);
  assert.equal(verdict.tone, "stale");
  assert.equal(verdict.label, "Data: no recent data");
});

test("every amber or red says what was expected and what was seen", () => {
  const activity = activityFor("wbgt", CCCC, MONDAY_1030);
  const verdict = assessIngestionHealth(target, reading(SATURDAY_LAST), MONDAY_1030, activity);
  assert.ok(verdict.evidence && verdict.evidence.length >= 2);
  assert.match(verdict.evidence[0], /^Expected: .* in hours 8–19 SGT, so the longest normal silence is 2 h\.$/);
  assert.match(verdict.evidence[1], /^Seen: the newest reading arrived 41 h ago\.$/);

  // A green carries none: there is nothing to explain.
  const fine = assessIngestionHealth(target, reading("2026-10-19T02:10:00.000Z"), MONDAY_1030, activity);
  assert.equal(fine.tone, "good");
  assert.equal(fine.evidence, undefined);
});

test("the empty and missing-table reds also say what was seen", () => {
  const active = activityFor("wbgt", CCCC, MONDAY_1030);
  assert.match(assessIngestionHealth(target, { kind: "empty" }, MONDAY_1030, active).evidence?.[0] ?? "", /has no rows/);
  assert.match(assessIngestionHealth(target, { kind: "missing_table" }, MONDAY_1030, active).evidence?.[0] ?? "", /does not exist/);
});

test("HALO failing to read is not a red on the project, and never reads as healthy", () => {
  const verdict = assessIngestionHealth(target, { kind: "monitor_error" }, MONDAY_1030, activityFor("wbgt", CCCC, MONDAY_1030));
  // Amber: neutral renders green on the card, and a project HALO could not look at
  // must not look healthy. Not red: nothing is known to be wrong with the site.
  assert.equal(verdict.tone, "warn");
  assert.equal(verdict.label, "Data: monitor unavailable");
  assert.match(verdict.evidence?.[0] ?? "", /nothing about the project was judged/);
});

test("hours and ages read as sentences", () => {
  assert.equal(describeHours([8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19]), "8–11, 13–19");
  assert.equal(describeHours([20]), "20");
  assert.equal(describeAge(40 * 60_000), "40 min");
  assert.equal(describeAge(5 * 3_600_000), "5 h");
  assert.equal(describeAge(3 * 24 * 3_600_000), "3 days");
  assert.equal(describeAge(41 * 3_600_000), "41 h");
});

/** The service's own testimony, asked of its run log only when the age check has a finding. */
function world(options: { runs?: Array<Record<string, unknown>>; producer?: Array<Record<string, unknown>>; logFails?: boolean }) {
  const fetchImpl: typeof fetch = async (input) => {
    const url = decodeURIComponent(String(input));
    if (!url.includes("wbgt_job_runs")) return Response.json([{ created_at: SATURDAY_LAST, reading_timestamp: SATURDAY_LAST }]);
    if (options.logFails) return Response.json([], { status: 500 });
    // skippedSinceReading's two questions: nothing from the producer, newest run not a skip.
    if (url.includes("or=(")) return Response.json([]);
    if (url.includes("limit=6")) return Response.json([{ status: "completed_with_issues" }]);
    // serviceTestimony's two questions.
    // Answers only if the URL really asks for the scrape job: a reader that stopped
    // asking for it would get nothing back, instead of passing by luck.
    if (url.includes("limit=1")) return Response.json(url.includes("job_type=like.scrape*") ? options.producer ?? [] : []);
    return Response.json(options.runs ?? []);
  };
  return listProjectHealth({ wbgt: [CCCC] }, { fetchImpl, now: MONDAY_1030, url: "https://x.test", key: "k" });
}

const LABEL_ERROR = "CCCC — set the CloudLynx label: reading 1372 minutes old; production delivery suppressed";

test("the service's own words are attached, with how often it said them", async () => {
  const health = await world({
    runs: [3, 2, 1].map((n) => ({ started_at: `2026-10-19T02:${10 + n}:00Z`, status: "completed_with_issues", job_type: "wbgt-hourly", errors: [LABEL_ERROR] })),
    producer: [{ started_at: "2026-09-25T06:00:11Z", status: "completed_with_issues", job_type: "scrape-wbgt", errors: ["Missing configured sensors: CCCC — set the CloudLynx label"] }],
  });
  const verdict = health.get(healthKey("wbgt", "CCCC"))!;
  assert.equal(verdict.tone, "stale");
  const text = (verdict.evidence ?? []).join("\n");
  assert.match(text, /Service log: the newest of 3 runs since then was wbgt-hourly completed_with_issues at 19 Oct, 10:13 SGT — “CCCC — set the CloudLynx label: reading 1372 minutes old/);
  assert.match(text, /3 runs carry that same message/);
  assert.match(text, /Scrape: last ran scrape-wbgt completed_with_issues at 25 Sep, 14:00 SGT — “Missing configured sensors: CCCC — set the CloudLynx label” \(24 days ago\)/);
});

test("a service that has gone quiet is said to have gone quiet", async () => {
  const text = ((await world({ runs: [], producer: [] })).get(healthKey("wbgt", "CCCC"))?.evidence ?? []).join("\n");
  assert.match(text, /no run of any kind since that reading/);
  assert.match(text, /this project has no scrape run in the log/);
});

test("if the log cannot be read the evidence only gets shorter, and the red stays", async () => {
  const verdict = (await world({ logFails: true })).get(healthKey("wbgt", "CCCC"))!;
  assert.equal(verdict.tone, "stale");
  assert.equal(verdict.evidence?.length, 2);
  assert.match(verdict.evidence?.join("\n") ?? "", /^Expected: /);
});
