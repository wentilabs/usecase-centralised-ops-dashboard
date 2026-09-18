import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalProjectCandidates,
  validateCanonicalProjectDraft,
} from "../lib/canonical-projects";
import type { CanonicalProject } from "../lib/canonical-projects";
import { onboardingDraftFromCanonicalProject } from "../lib/canonical-project-onboarding";
import { onboardingFor } from "../lib/onboarding";
import type { ServiceRow } from "../lib/project-identity";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";

function row(service: ServiceKey, projectCode: string, extra: Record<string, unknown> = {}): ServiceRow {
  return { service, projectCode, row: { project_code: projectCode, ...extra } as ProjectConfigRow };
}

test("canonical candidates preserve each service's exact alias", () => {
  const candidates = canonicalProjectCandidates([
    row("wbgt", "CR 106", { company: "Woh Hup", lambda_url: "https://proxy/send-message" }),
    row("noise", "CR106", { company: "Woh Hup", lambda_url: "https://proxy/send-message" }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].draft.primary_alias, "CR106");
  assert.deepEqual(candidates[0].draft.alternate_aliases, ["CR 106"]);
  assert.deepEqual(candidates[0].draft.service_aliases, { wbgt: "CR 106", noise: "CR106" });
  assert.equal(candidates[0].draft.company, "Woh Hup");
  assert.equal(candidates[0].draft.send_message_url, "https://proxy/send-message");
});

test("a disagreement is a review conflict, never an automatic common value", () => {
  const [candidate] = canonicalProjectCandidates([
    row("haze", "CFC", { latitude: 1.29, longitude: 103.85, lambda_url: "https://a/send-message" }),
    row("lightning", "CFC", { latitude: 1.3, longitude: 103.85, lambda_url: "https://b/send-message" }),
  ]);
  assert.equal(candidate.draft.latitude, null);
  assert.equal(candidate.draft.send_message_url, null);
  assert.ok(candidate.conflicts.some((conflict) => conflict.field === "latitude"));
  assert.ok(candidate.conflicts.some((conflict) => conflict.field === "send_message_url"));
});

test("canonical validation rejects unknown service aliases and half coordinates", () => {
  const { draft, problems } = validateCanonicalProjectDraft({
    primary_alias: "CFC",
    service_aliases: { madeUp: "CFC" },
    latitude: 1.3,
  });
  assert.equal(draft, null);
  assert.ok(problems.some((problem) => /Unknown service alias/.test(problem)));
  assert.ok(problems.some((problem) => /Coordinates need both/.test(problem)));
});

const project: CanonicalProject = {
  id: "00000000-0000-0000-0000-000000000001",
  primary_alias: "CFC",
  alternate_aliases: ["Clifford Centre"],
  service_aliases: {},
  company: "Woh Hup",
  site_name: "Clifford Centre",
  site_address: "24 Raffles Place",
  latitude: 1.284,
  longitude: 103.851,
  safety_workbook_id: "safety-id",
  manpower_workbook_id: "manpower-id",
  send_message_url: "https://proxy.example/send-message",
  reply_message_url: "https://proxy.example/reply-message",
  send_document_url: "https://proxy.example/send-document",
  whatsapp_instance_name: "woh-hup",
  whatsapp_client_id: "client-1",
  timezone: "Asia/Singapore",
  public_holiday_region: "SG",
  general_notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

test("onboarding receives only exact approved canonical mappings", () => {
  const issue = onboardingDraftFromCanonicalProject(onboardingFor("issueChaser")!, project);
  assert.equal(issue.project_code, "CFC");
  assert.equal(issue.safety_sheet_id, "safety-id");
  assert.equal(issue.lambda_url, "https://proxy.example/send-message");
  assert.equal(issue.spreadsheet_id, undefined, "Issue Chaser must not receive the manpower workbook");

  const ailytics = onboardingDraftFromCanonicalProject(onboardingFor("ailytics")!, project);
  assert.equal(ailytics.spreadsheet_id, undefined, "Ailytics workbook is not declared equivalent to the safety workbook");
  assert.equal(ailytics.reply_lambda_url, "https://proxy.example/reply-message");
});
