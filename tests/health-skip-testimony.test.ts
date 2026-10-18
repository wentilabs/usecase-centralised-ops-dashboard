import assert from "node:assert/strict";
import test from "node:test";

import { healthKey } from "../lib/data-health";
import { listProjectHealth } from "../lib/data-health-reader";

/**
 * Four noise projects went red on a Sunday afternoon for doing exactly what they
 * were told.
 *
 * ZRB mutes Sundays, its cadence windows cover 14:00, and Noise skips on purpose —
 * `skipped_sunday_notifications_disabled`, every five minutes — so no reading was
 * ever going to arrive. HALO models "should something have happened this hour"
 * from the configured cadence hours, which cannot know about a calendar mute.
 *
 * The service's own run log settles it, and these tests pin that AND its limits:
 * a rule that clears reds is only safe if it refuses to clear the wrong ones.
 *
 * What the real data looked like, and why the rule is shaped the way it is. After
 * each project's last reading, the only non-skip runs were a `noise-5min` that
 * finished twelve seconds later and a daily `noise-limits-refresh` three hours
 * on. Neither is evidence the pipeline works or fails. The first version of this
 * rule asked "has ANY run since the reading been a non-skip?" and so cleared none
 * of them; a version before it read only the newest few runs and would have
 * cleared a project whose scrape had been running for weeks and finding nothing.
 * Only the SCRAPE says anything about whether readings are being produced.
 */
const NOW = new Date("2026-10-18T06:05:00.000Z"); // Sunday 14:05 SGT
const LAST_READING = "2026-10-17T22:58:29.326Z"; // Sunday 06:58 SGT — seven hours stale

type Run = { job_type: string; status: string };

const skip = (job_type = "noise-5min"): Run => ({ job_type, status: "skipped_sunday_notifications_disabled" });
const SUNDAY: Run[] = [skip(), skip("noise-half-hourly"), skip(), skip("noise-half-hourly"), skip(), skip("noise-half-hourly")];

const row = (projectCode: string, service: "noise" | "wbgt") => ({
  project_code: projectCode,
  enabled: true,
  whatsapp_group_id: "120363000000000000@g.us",
  enable_hourly: true,
  ...(service === "wbgt" ? { site_hours_start: 8, site_hours_end: 21 } : {}),
});

type Call = { url: string; profile: string | null };
type Failure = "both" | "producer" | "newest" | "throw";

/**
 * A run table that answers as the database would: `runs` are the rows since the
 * last reading, newest first. The producer-or-failure question filters them by
 * the job type and status the URL actually asks for — so a rule that stopped
 * asking for the scrape would visibly change the answer rather than pass by luck.
 *
 * A failure is a bad status with a body that LOOKS like an answer. For the
 * producer question that is an empty list, which reads as "the scrape did not
 * run" — the one answer that clears a red. An error object would be rejected by
 * the array check before the status check was exercised, which is how earlier
 * versions of these assertions were vacuous.
 */
function world(runs: Run[], service: "noise" | "wbgt", failure?: Failure) {
  const calls: Call[] = [];
  const logTable = service === "noise" ? "noise_job_runs" : "wbgt_job_runs";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = decodeURIComponent(String(input));
    calls.push({ url, profile: new Headers(init?.headers).get("Accept-Profile") });
    if (!url.includes(logTable)) {
      return Response.json(
        service === "noise"
          ? [{ created_at: LAST_READING, date: "2026-10-17", time_hhmm: "22:58" }]
          : [{ created_at: LAST_READING, reading_timestamp: LAST_READING }],
      );
    }
    if (failure === "throw") throw new Error("socket timed out");
    const asksProducer = url.includes("or=(");
    if (failure === "both" || (failure === "producer" && asksProducer) || (failure === "newest" && !asksProducer)) {
      return Response.json(asksProducer ? [] : runs.slice(0, 6).map((run) => ({ status: run.status })), { status: 500 });
    }
    if (asksProducer) {
      const wantsScrape = url.includes("job_type.like.scrape*");
      const wantsFailed = url.includes("status.like.failed*");
      const hits = runs.filter(
        (run) => (wantsScrape && run.job_type.startsWith("scrape")) || (wantsFailed && run.status.startsWith("failed")),
      );
      return Response.json(hits.slice(0, 1).map((run) => ({ status: run.status })));
    }
    return Response.json(runs.slice(0, 6).map((run) => ({ status: run.status })));
  };
  return { calls, fetchImpl };
}

async function verdictFor(runs: Run[], { service = "noise", code = "ZRB", failure }: { service?: "noise" | "wbgt"; code?: string; failure?: Failure } = {}) {
  const { calls, fetchImpl } = world(runs, service, failure);
  const health = await listProjectHealth(
    { [service]: [row(code, service)] },
    { fetchImpl, now: NOW, url: "https://health.example", key: "test-key" },
  );
  return { calls, health: health.get(healthKey(service, code))! };
}

test("a stale project whose service chose not to work is idle, not red", async () => {
  const { health } = await verdictFor(SUNDAY);

  assert.equal(health.tone, "neutral", "nothing was expected, so nothing is wrong");
  // The service's own word is the reason, unrewritten, so it can be searched for.
  assert.equal(health.label, "Data: idle — skipped_sunday_notifications_disabled");
  // It is only the VERDICT that changes. The card still says when data last arrived.
  assert.equal(health.newestReceivedAt, "2026-10-17T22:58:29.326Z");
});

test("a same-cycle alert run and a maintenance job after the reading do not count against it", async () => {
  // Exactly what ZRB's log showed: a noise-5min that completed twelve seconds
  // after the reading, and noise-limits-refresh at 02:00. Neither produces
  // readings, so neither says anything about whether the pipeline works.
  const runs: Run[] = [
    ...SUNDAY,
    { job_type: "noise-limits-refresh", status: "completed" },
    { job_type: "noise-5min", status: "completed" },
  ];
  const { health } = await verdictFor(runs);
  assert.equal(health.tone, "neutral");
});

test("two questions are asked, of the right log, for this project, since the last reading", async () => {
  const { calls } = await verdictFor(SUNDAY);
  const asks = calls.filter((call) => call.url.includes("noise_job_runs"));
  assert.equal(asks.length, 2);

  for (const ask of asks) {
    assert.equal(ask.profile, "noise-meters");
    assert.match(ask.url, /project_code=eq\.ZRB/);
    assert.match(ask.url, /order=started_at\.desc/);
    // Since the reading, not "recently". The timestamp is encoded in the request
    // (a raw `+` decodes to a space); `world` decodes it only to read it here.
    assert.match(ask.url, /started_at=gt\.2026-10-17T22:58:29\.326Z/);
  }
  const producer = asks.find((ask) => ask.url.includes("or=("))!;
  assert.match(producer.url, /job_type\.like\.scrape\*/, "asks about the scrape, not about any run");
  assert.match(producer.url, /status\.like\.failed\*/, "and about any failure");
  assert.match(producer.url, /limit=1(&|$)/);
  assert.ok(asks.some((ask) => !ask.url.includes("or=(") && /limit=6/.test(ask.url)), "and the latest few runs");
});

test("the SCRAPE having run since the reading, and found nothing, stays red", async () => {
  // The fault this exists to leave alone: the producer ran, and no reading
  // followed. Whatever the newest runs say, a project whose scrape has been
  // completing for days without producing data is broken, not muted.
  const runs: Run[] = [...SUNDAY, { job_type: "scrape-noiselynx", status: "completed" }];
  const { health } = await verdictFor(runs, { code: "OBAYA" });
  assert.equal(health.tone, "danger");
  assert.equal(health.label, "Data: no recent data");
});

test("a failed run since the reading stays red, whatever else the log says", async () => {
  const runs: Run[] = [...SUNDAY, { job_type: "noise-hourly", status: "failed_config_validation" }];
  assert.equal((await verdictFor(runs)).health.tone, "danger");
});

test("no run at all is not an explanation, because a silent cron is what stale exists to catch", async () => {
  assert.equal((await verdictFor([])).health.tone, "danger");
});

test("the newest run must itself be a deliberate skip", async () => {
  // The project is working right now — a scrape would have been caught above, but
  // an alert run completing is the service doing something, not declining to.
  const runs: Run[] = [{ job_type: "noise-5min", status: "completed" }, ...SUNDAY];
  assert.equal((await verdictFor(runs)).health.tone, "danger");
});

test("a skip that names a fault, mixed among ordinary skips, is not an explanation", async () => {
  // `skipped_` normally means "not due", so it would pass a prefix check. A sheet
  // that is not configured is a project that cannot run, hiding among muted ones.
  const runs: Run[] = [...SUNDAY.slice(0, 5), { job_type: "noise-5min", status: "skipped_google_sheet_not_configured" }];
  assert.equal((await verdictFor(runs)).health.tone, "danger");
  // An unrecognised word is not a deliberate skip either.
  assert.equal((await verdictFor([{ job_type: "noise-5min", status: "bootstrap_required" }])).health.tone, "danger");
});

test("being unable to ask never clears a red, whichever question failed", async () => {
  assert.equal((await verdictFor(SUNDAY, { failure: "both" })).health.tone, "danger", "a 500 from both");
  assert.equal((await verdictFor(SUNDAY, { failure: "throw" })).health.tone, "danger", "a timeout");
  // Each alone. A failing producer question returns an empty list, which reads as
  // "the scrape did not run" — the one answer that clears a red — so the STATUS
  // has to be checked, not just the body.
  assert.equal((await verdictFor(SUNDAY, { failure: "producer" })).health.tone, "danger", "only the producer question failed");
  assert.equal((await verdictFor(SUNDAY, { failure: "newest" })).health.tone, "danger", "only the newest-runs question failed");
});

test("a merely delayed project is explained too, not only a red one", async () => {
  // 2h15 old. An hourly cadence tolerates two hours (the gap plus an hour of
  // grace) and calls four critical, so this is the "delayed" band — a reading
  // 1h35 old would simply be healthy.
  const recent = "2026-10-18T03:50:00.000Z";
  const stale = (runs: Run[]) => {
    const { fetchImpl } = world(runs, "noise");
    const patched: typeof fetch = async (input, init) =>
      decodeURIComponent(String(input)).includes("noise_job_runs")
        ? fetchImpl(input, init)
        : Response.json([{ created_at: recent, date: "2026-10-18", time_hhmm: "11:50" }]);
    return listProjectHealth({ noise: [row("ZRB", "noise")] }, { fetchImpl: patched, now: NOW, url: "https://health.example", key: "k" });
  };

  // Without an explanation it really is the delayed band, so the test is about
  // the rule and not about a project that was never going to be flagged.
  const unexplained = await stale([{ job_type: "scrape-noiselynx", status: "completed" }, ...SUNDAY]);
  assert.equal(unexplained.get(healthKey("noise", "ZRB"))?.tone, "warn");

  const explained = await stale(SUNDAY);
  assert.equal(explained.get(healthKey("noise", "ZRB"))?.tone, "neutral");
});

test("a healthy project costs nothing extra", async () => {
  const { calls, fetchImpl } = world(SUNDAY, "noise");
  const fresh: typeof fetch = async (input, init) => {
    await fetchImpl(input, init);
    return Response.json([{ created_at: "2026-10-18T06:00:00.000Z", date: "2026-10-18", time_hhmm: "14:00" }]);
  };
  const health = await listProjectHealth(
    { noise: [row("ZRB", "noise")] },
    { fetchImpl: fresh, now: NOW, url: "https://health.example", key: "k" },
  );
  assert.equal(health.get(healthKey("noise", "ZRB"))?.tone, "good");
  // One request, as before. The run log is asked only when a problem is about to
  // be reported, so a quiet estate pays nothing for this.
  assert.equal(calls.filter((call) => call.url.includes("noise_job_runs")).length, 0);
});

test("WBGT is explained from its own run log, naming its own scrape", async () => {
  const skipped: Run = { job_type: "wbgt-hourly", status: "skipped_outside_site_hours" };
  const { health, calls } = await verdictFor([skipped, skipped, skipped], { service: "wbgt", code: "C 991" });
  assert.equal(health.tone, "neutral");
  assert.equal(health.label, "Data: idle — skipped_outside_site_hours");
  const asks = calls.filter((call) => call.url.includes("wbgt_job_runs"));
  assert.equal(asks[0].profile, "wbgts");
  assert.ok(asks.some((ask) => ask.url.includes("job_type.like.scrape*")));

  // And a WBGT scrape that ran and produced nothing stays red.
  const scraped = await verdictFor([skipped, { job_type: "scrape-wbgt", status: "completed_with_issues" }], { service: "wbgt", code: "C 991" });
  assert.equal(scraped.health.tone, "danger");
});
