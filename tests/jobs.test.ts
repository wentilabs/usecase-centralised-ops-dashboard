import assert from "node:assert/strict";
import test from "node:test";

import { EXPORTS, JOBS, JOB_KEYS, isExportKey, jobTargets, validateJobInput } from "../lib/jobs";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { summariseJobResult } from "../lib/read-json";
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
    ...JOB_KEYS.map((key) => ({ key: key as string, service: JOBS[key].service, path: JOBS[key].path })),
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

test("the refresh payload is snake_case and carries dryRun only when asked", () => {
  const job = JOBS["chaser-refresh-images"];
  assert.deepEqual(job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "" }), {
    project_code: "IR2",
  });
  assert.deepEqual(
    job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", flags: { dryRun: true } }),
    { project_code: "IR2", dryRun: true },
  );
  // A false flag is absence, not `dryRun: false` — the handler treats only
  // `=== true` as a preview, so sending the key at all is misleading.
  assert.deepEqual(
    job.buildPayload({ projectCode: "IR2", startDate: "", endDate: "", flags: { dryRun: false } }),
    { project_code: "IR2" },
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
