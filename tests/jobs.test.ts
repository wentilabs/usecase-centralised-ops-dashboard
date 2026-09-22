import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPORTS,
  JOBS,
  JOB_KEYS,
  defaultChoice,
  isExportKey,
  jobPath,
  jobPaths,
  jobTargets,
  validateJobInput,
} from "../lib/jobs";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { previewMessages, summariseJobResult } from "../lib/read-json";
import type { ProjectConfigRow } from "../lib/services";

/**
 * The registry describes endpoints that live in other repositories, so the way
 * it goes wrong is drift: a path renamed upstream, or a job pointed at a route
 * that was never there. Every job's path is checked against the service's
 * PINNED contract, which is the one thing in HALO that provably came from the
 * service itself.
 */
test("every job and export posts to a route its service's pinned contract declares", () => {
  const targets = [
    // Every path, not just the primary one: a job with a `choice` reaches
    // several, and the one most likely to be renamed upstream is the one
    // nobody clicks.
    ...JOB_KEYS.flatMap((key) =>
      jobPaths(JOBS[key]).map((path) => ({ key: key as string, service: JOBS[key].service, path })),
    ),
    ...Object.keys(EXPORTS)
      .filter(isExportKey)
      .map((key) => ({ key: key as string, service: EXPORTS[key].service, path: EXPORTS[key].path })),
  ];
  assert.ok(targets.length >= 6, "the registry emptied out — this check would then assert nothing");

  for (const target of targets) {
    const contract = SERVICE_CONTRACTS[target.service];
    assert.ok(contract, `${target.key} runs on ${target.service}, which has no pinned contract`);
    const declared = contract.routes.filter(
      (route) => route.path === target.path && route.method === "POST",
    );
    assert.equal(
      declared.length,
      1,
      `${target.key} posts to ${target.path}, which ${target.service}'s pinned contract does not declare`,
    );
  }
});

test("the safety image refresh is pinned to the contract route that carries it", () => {
  const job = JOBS["chaser-refresh-images"];
  assert.equal(job.service, "issueChaser");
  assert.equal(job.path, "/api/refresh-safety-image-links");
  const route = SERVICE_CONTRACTS.issueChaser.routes.find((entry) => entry.path === job.path);
  // `operator` rather than `scheduled`: nothing invokes it on a cron, which is
  // exactly why it needs a button.
  assert.deepEqual(route, {
    method: "POST",
    path: "/api/refresh-safety-image-links",
    kind: "operator",
    authentication: "optional-service-key",
  });
});

test("a dateless job asks for no range, and a ranged one still does", () => {
  const ready = "1AbC…";

  assert.deepEqual(
    validateJobInput({ projectCode: "IR2" }, { job: JOBS["chaser-refresh-images"], ready }),
    [],
    "a dateless job should be runnable with a project alone",
  );

  const ranged = validateJobInput({ projectCode: "IR2" }, { job: JOBS["noise-sync"], ready });
  assert.deepEqual(ranged, ["Start date must be YYYY-MM-DD.", "End date must be YYYY-MM-DD."]);

  // Dropping the dates must not drop the project with them: every job runs
  // against one project, and the route 404s on an undefined code.
  assert.deepEqual(validateJobInput({}, { job: JOBS["chaser-refresh-images"], ready }), [
    "Choose a project.",
  ]);

  // The default when no job is supplied at all must stay "dates required" — a
  // caller that forgets to pass the job should be refused, not waved through.
  assert.ok(validateJobInput({ projectCode: "IR2" }, { ready }).length > 0);
});

test("a dateless job ignores any range it is handed, and is never chunked", () => {
  const dateless = JOB_KEYS.filter((key) => JOBS[key].dateless);
  assert.ok(dateless.length > 0, "no dateless job left — this check would then assert nothing");

  for (const key of dateless) {
    const job = JOBS[key];
    assert.deepEqual(
      job.buildPayload({ projectCode: "IR2", startDate: "2026-01-01", endDate: "2026-01-31" }),
      job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "" }),
      `${key} is dateless but its payload changes when a range is passed`,
    );
    // Chunking divides a range. Without one there is nothing to divide, and a
    // chunkDays here would make the client send the same request twice.
    assert.equal(job.chunkDays, undefined, `${key} is dateless, so there is nothing to chunk`);
  }
});

test("the refresh payload is snake_case, and previews unless apply is ticked", () => {
  const job = JOBS["chaser-refresh-images"];
  // Nothing ticked is the case that actually happens — the route forwards only
  // flags that are true — so it has to be the preview.
  assert.deepEqual(job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "" }), {
    project_code: "IR2",
    dryRun: true,
  });
  assert.deepEqual(
    job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", flags: { apply: true } }),
    { project_code: "IR2", dryRun: false },
  );
  // An explicitly false flag is the same as absent, not the same as ticked.
  assert.deepEqual(
    job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", flags: { apply: false } }),
    { project_code: "IR2", dryRun: true },
  );
});

test("the refresh needs a real Safety workbook id", () => {
  const rows = [
    { project_code: "IR2", safety_sheet_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" },
    // Real rows carry these: the placeholders `readSheetId` treats as unset.
    { project_code: "WCP", safety_sheet_id: "-" },
    { project_code: "TBS", safety_sheet_id: "" },
    { project_code: "SKW" },
  ] as unknown as ProjectConfigRow[];

  const targets = jobTargets(JOBS["chaser-refresh-images"], rows);
  assert.deepEqual(
    targets.map((target) => [target.projectCode, Boolean(target.ready)]),
    [
      ["IR2", true],
      ["SKW", false],
      ["TBS", false],
      ["WCP", false],
    ],
  );
  // Listed, not hidden. This precondition has no per-row `detail`, so the
  // target carries no reason and the callers fall back to `unmet` — which has
  // to name the field, or a blocked project sits in the picker unexplained.
  assert.equal(targets.find((target) => target.projectCode === "WCP")?.reason, null);
  assert.match(JOBS["chaser-refresh-images"].precondition.unmet("WCP"), /Safety workbook ID.*WCP/);
});

test("the refresh result reads as counts and names the cells that failed", () => {
  // The shape `runRefreshSafetyImages` returns for one project, trimmed.
  const result = {
    success: false,
    style: "safety_image_refresh",
    dryRun: false,
    projects: [
      {
        project_code: "IR2",
        style: "safety_image_refresh",
        success: false,
        tabs: { "Safety-Sep 2026": { scanned: 120, eligible: 40, updated: 38, skipped: 80, failed: 2 } },
        eligible: 40,
        updated: 38,
        skipped: 80,
        failed: 2,
        failures: [{ tab: "Safety-Sep 2026", range: "'Safety-Sep 2026'!K14", error: "signed url refused" }],
      },
    ],
    totals: { eligible: 40, updated: 38, skipped: 80, failed: 2 },
  };

  const line = summariseJobResult(result);
  assert.match(line, /40 eligible/);
  assert.match(line, /38 updated/);
  assert.match(line, /2 failed/);
  // The tab and cell, not just that something broke.
  assert.match(line, /Safety-Sep 2026'!K14/);
  assert.match(line, /signed url refused/);
});

test("a clean refresh says what it did without inventing a failure", () => {
  const line = summariseJobResult({
    success: true,
    dryRun: true,
    projects: [{ project_code: "IR2", eligible: 12, updated: 0, skipped: 300, failed: 0 }],
    totals: { eligible: 12, updated: 0, skipped: 300, failed: 0 },
  });
  assert.match(line, /12 eligible/);
  assert.doesNotMatch(line, /failed/);
  assert.doesNotMatch(line, /0 updated/);
});


test("a job with several endpoints resolves the one its choice names", () => {
  const job = JOBS["chaser-summary-preview"];
  assert.equal(defaultChoice(job), "plain");
  assert.equal(jobPath(job, "plain"), "/api/past-days-safety-summary");
  assert.equal(jobPath(job, "company"), "/api/past-days-company-safety-summary");
  assert.equal(jobPath(job, "chatgroup"), "/api/past-days-chatgroup-safety-summary");
  assert.equal(jobPath(job, "novade"), "/api/remind-write-novade-names");
  // A chat-planned run carries no choice, and an option that no longer exists
  // must not resolve to whatever Object.values happens to yield first.
  assert.equal(jobPath(job, undefined), "/api/past-days-safety-summary");
  assert.equal(jobPath(job, "invented"), "/api/past-days-safety-summary");
  // Four options, four distinct endpoints — a duplicate would mean two labels
  // quietly doing the same thing.
  assert.equal(jobPaths(job).length, job.choice?.options.length);
});

test("a choice the job does not declare is refused rather than defaulted", () => {
  const ready = "1AbC…";
  assert.deepEqual(validateJobInput({ projectCode: "IR2", choice: "plain" }, { job: JOBS["chaser-summary-preview"], ready }), []);
  const problems = validateJobInput({ projectCode: "IR2", choice: "weekly" }, { job: JOBS["chaser-summary-preview"], ready });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /weekly is not one of report/);
  // A job with no choice ignores one entirely — the route drops it.
  assert.deepEqual(validateJobInput({ projectCode: "IR2", choice: "weekly" }, { job: JOBS["chaser-project-check"], ready }), []);
});

test("every Issue Chaser job that can change something previews by default", () => {
  const chaser = JOB_KEYS.filter((key) => JOBS[key].service === "issueChaser");
  assert.ok(chaser.length >= 4, "the Chaser jobs went away — this check would then assert nothing");

  for (const key of chaser) {
    const job = JOBS[key];
    const payload = job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", choice: defaultChoice(job) });

    if (job.appliesWhen) {
      // Unticked must mean dry run. The route forwards only flags that are
      // true, so an absent flag is the case that actually happens.
      assert.equal(payload.dryRun, true, `${key} writes when its flag is absent`);
      assert.equal(
        job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", flags: { [job.appliesWhen]: true } }).dryRun,
        false,
        `${key} still previews when ${job.appliesWhen} is ticked`,
      );
      assert.ok(
        job.flags?.some((flag) => flag.key === job.appliesWhen),
        `${key} names ${job.appliesWhen} but does not offer it as a flag`,
      );
    } else {
      // No apply flag means the job cannot act at all, so it must pin dryRun
      // itself or be a pure read.
      assert.ok(
        payload.dryRun === true || job.resultView === "json" || job.path === "/api/issue-chaser-project-check",
        `${key} neither previews nor declares how it is allowed to act`,
      );
    }
  }
});

test("a preview's messages are found under either key the service uses", () => {
  // A chase run: results[].results[] with a kind.
  const chase = {
    results: [
      {
        project_code: "IR2",
        results: [
          { chatId: "1@g.us", kind: "issue", message: "SN 12 is still open", sent: false },
          { chatId: "2@g.us", kind: "summary", message: "3 open today", sent: false },
        ],
      },
    ],
  };
  assert.deepEqual(previewMessages(chase), [
    { chatId: "1@g.us", kind: "issue", message: "SN 12 is still open" },
    { chatId: "2@g.us", kind: "summary", message: "3 open today" },
  ]);

  // A summary run: results[].send_results[], with no kind at all.
  const summary = {
    results: [{ project_code: "IR2", send_results: [{ chatId: "9@g.us", sent: false, message: "5 days, 12 open" }] }],
  };
  assert.deepEqual(previewMessages(summary), [{ chatId: "9@g.us", kind: "summary", message: "5 days, 12 open" }]);

  // A report with nothing to say sends nothing, which is not a failure.
  assert.deepEqual(previewMessages({ results: [{ project_code: "IR2", send_results: [] }] }), []);
  // A blank message is absence, not a message.
  assert.deepEqual(previewMessages({ results: [{ chatId: "1@g.us", message: "   " }] }), []);
});


test("the chase preview sends the style it was asked for, and cannot deliver", () => {
  const job = JOBS["chaser-preview"];
  // The style is the whole point of this job: it is the one Chaser route that
  // reads `style` from the body rather than hard-coding its own.
  assert.deepEqual(job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", choice: "same_day_open" }), {
    project_code: "IR2",
    style: "same_day_open",
    dryRun: true,
  });
  assert.equal(
    job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", choice: "severity_cadence" }).style,
    "severity_cadence",
  );
  // No flag can turn this into a send — there is nothing to tick.
  assert.equal(job.appliesWhen, undefined);
  assert.equal(job.flags, undefined);
});

test("the summary preview asks for an immediate build, not a scheduled one", () => {
  const job = JOBS["chaser-summary-preview"];
  const payload = job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", choice: "plain" });

  // `scheduled` defaults to TRUE on these routes, and a scheduled run only
  // fires when the project's local hour matches its configured schedule. Omit
  // this and a preview asked for at 14:00 against an 08:00 report comes back
  // skipped, which reads as a broken configuration rather than as the wrong
  // question. It is the single most load-bearing key in this payload.
  assert.equal(payload.scheduled, false);
  assert.equal(payload.dryRun, true);
  assert.deepEqual(payload, { project_code: "IR2", scheduled: false, dryRun: true });

  // Same payload whichever report is chosen — only the endpoint changes.
  for (const option of job.choice!.options) {
    assert.deepEqual(
      job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", choice: option.value }),
      payload,
      `${option.value} builds a different body from the others`,
    );
  }
  assert.equal(job.appliesWhen, undefined, "a summary preview must offer no way to send");
});
