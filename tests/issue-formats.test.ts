import test from "node:test";
import assert from "node:assert/strict";
import { buildFieldSpec } from "../lib/field-spec";
import { onboardingFor, buildInsertRow, validateDraft } from "../lib/onboarding";
import { issueChaserScheduleProvider } from "../lib/card-summary/schedule-providers/issue-chaser";
import { issueChaserPills } from "../lib/card-summary/pill-providers/issue-chaser";
import { issueChaserLoadProvider } from "../lib/load-model/providers/issue-chaser";
import { routesForField } from "../lib/field-routes";
import { rowProblems } from "../lib/row-rules";
import type { ProjectConfigRow } from "../lib/services";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("issue format is an introspected select with a Wohhup default and explicit CCCC choice", () => {
  const spec = buildFieldSpec("issueChaser", { issues_format: { type: "text", default: "wohhup_issue_format" } });
  assert.equal(spec.fields.issues_format.widget, "select");
  assert.deepEqual(spec.fields.issues_format.options, ["wohhup_issue_format", "cccc_issue_format"]);
  assert.equal(spec.fields.issues_format.default, "wohhup_issue_format");
  assert.ok(spec.groups.some((group) => group.fields.includes("issues_format")));
  const definition = onboardingFor("issueChaser")!;
  assert.equal(buildInsertRow(definition, { project_code: "NEW" }, {}).issues_format, "wohhup_issue_format");
  assert.equal(buildInsertRow(definition, { project_code: "NEW", issues_format: "cccc_issue_format" }, {}).issues_format, "cccc_issue_format");
  assert.ok(validateDraft(definition, { project_code: "NEW", issues_format: "typo" }, []).some((problem) => problem.includes("Issues format")));
  assert.ok(rowProblems("issueChaser", { issues_format: "typo" }).some((problem) => problem.columns.includes("issues_format")));
});

test("CCCC cards explain first targets and the shared successful-delivery cooldown", () => {
  const config = { project_code: "TEST", enabled: true, severity_cadence_chaser_enabled: true, issues_format: "cccc_issue_format", send_to_originating_groups: false, whatsapp_group_ids: "123@g.us" } as ProjectConfigRow;
  const text = issueChaserScheduleProvider.firesAt(config);
  assert.match(text, /A1 next eligible check/);
  assert.match(text, /A2 after 24h, B after 3 days, C after 7 days/);
  assert.match(text, /all repeat every 3h after successful delivery/);
  assert.doesNotMatch(text, /P[123]/);
  assert.ok(issueChaserPills(config).some((pill) => pill.label === "CCCC format" && pill.on));
  const load = issueChaserLoadProvider.forRow(config);
  assert.ok(load.occurrences.every((entry) => entry.cadence.startsWith("A1 chase")));
  assert.ok(load.occurrences.length > 0);
  assert.match(issueChaserScheduleProvider.firesAt({ ...config, issues_format: undefined }), /P1 every 3h/);
  assert.ok(!issueChaserPills({ ...config, issues_format: undefined }).some((pill) => pill.label === "CCCC format"));
});

test("format field names all affected reminder, report and operator routes", () => {
  const routes = routesForField("issueChaser", "issues_format");
  assert.equal(routes.length, 10);
  for (const route of ["POST /api/issue-chaser-company-open", "POST /api/past-days-chatgroup-safety-summary", "POST /api/issue-chaser-operator-send"]) assert.ok(routes.includes(route));
});

test("format previews match the actual Issue Chaser message builders", (t) => {
  if (!existsSync(resolve("../usecase-issue-chaser/lib/messages.js"))) return t.skip("sibling Issue Chaser checkout unavailable");
  const output = resolve(tmpdir(), `halo-issue-format-preview-${process.pid}.ts`);
  try {
    execFileSync(process.execPath, ["scripts/build-issue-chaser-previews.mjs"], { env: { ...process.env, ISSUE_PREVIEWS_OUT: output } });
    assert.equal(readFileSync(output, "utf8"), readFileSync("lib/issue-chaser-previews.generated.ts", "utf8").replace(/\r\n/g, "\n"));
  } finally {
    rmSync(output, { force: true });
  }
});
