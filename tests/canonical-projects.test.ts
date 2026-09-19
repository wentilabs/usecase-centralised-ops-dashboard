import assert from "node:assert/strict";
import test from "node:test";

import {
  blankCanonicalProjectDraft,
  canonicalDeliveryDefaults,
  canonicalProjectMapHref,
  canonicalProjectMatches,
  canonicalSheetHref,
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

test("canonical workbook values become safe Google Sheets links", () => {
  assert.equal(canonicalSheetHref("1AbCdEfGhIjKlMnOpQrStUvWxYz123456"), "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/edit");
  assert.equal(canonicalSheetHref("https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=1"), "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=1");
  assert.equal(canonicalSheetHref("-"), null);
  assert.equal(canonicalSheetHref("not a sheet"), null);
});

test("canonical candidates preserve each service's exact alias", () => {
  const candidates = canonicalProjectCandidates([
    row("wbgt", "CR 106", { company: "Woh Hup", lambda_url: "https://proxy/send-message", monthly_sheet_id: "wbgt-sheet" }),
    row("noise", "CR106", { company: "Woh Hup", lambda_url: "https://proxy/send-message", google_sheet_id: "noise-sheet" }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].draft.primary_alias, "CR106");
  assert.deepEqual(candidates[0].draft.alternate_aliases, ["CR 106"]);
  assert.deepEqual(candidates[0].draft.service_aliases, { wbgt: "CR 106", noise: "CR106" });
  assert.equal(candidates[0].draft.company, "Woh Hup");
  assert.equal(candidates[0].draft.send_message_url, "https://proxy/send-message");
  assert.equal(candidates[0].draft.reply_message_url, "https://proxy/reply-message");
  assert.equal(candidates[0].draft.send_document_url, "https://proxy/send-document");
  assert.equal(candidates[0].draft.noise_workbook_id, "noise-sheet");
  assert.equal(candidates[0].draft.wbgt_workbook_id, "wbgt-sheet");
});

test("delivery sibling URLs are derived only from the exact send-message route", () => {
  const [candidate] = canonicalProjectCandidates([
    row("wbgt", "CFC", { lambda_url: "https://proxy.example/proxy" }),
    row("noise", "CFC", { lambda_url: "-" }),
  ]);
  assert.equal(candidate.draft.send_message_url, "https://proxy.example/proxy");
  assert.equal(candidate.draft.reply_message_url, null);
  assert.equal(candidate.draft.send_document_url, null);
});

test("HALO's configured proxy defaults prefill canonical delivery URLs", () => {
  const [candidate] = canonicalProjectCandidates(
    [row("wbgt", "CFC", { lambda_url: "https://legacy.example/send-message" })],
    {
      send_message_url: "https://halo.example/send-message",
      reply_message_url: "https://halo.example/reply-message",
      send_document_url: "https://halo.example/send-document",
    },
  );
  assert.equal(candidate.draft.send_message_url, "https://halo.example/send-message");
  assert.equal(candidate.draft.reply_message_url, "https://halo.example/reply-message");
  assert.equal(candidate.draft.send_document_url, "https://halo.example/send-document");
});

test("explicit Ailytics delivery URLs must agree with sibling URLs derived from other services", () => {
  const [candidate] = canonicalProjectCandidates([
    row("wbgt", "CFC", { lambda_url: "https://proxy.example/proxy/send-message" }),
    row("ailytics", "CFC", {
      lambda_url: "https://proxy.example/proxy/send-message",
      reply_lambda_url: "https://different.example/reply-message",
      lambda_url_image: "https://proxy.example/proxy/send-document",
    }),
  ]);
  assert.equal(candidate.draft.reply_message_url, null);
  assert.ok(candidate.conflicts.some((conflict) => conflict.field === "reply_message_url"));
  assert.equal(candidate.draft.send_document_url, "https://proxy.example/proxy/send-document");
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
  noise_workbook_id: "noise-id",
  wbgt_workbook_id: "wbgt-id",
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

  const noise = onboardingDraftFromCanonicalProject(onboardingFor("noise")!, project);
  assert.equal(noise.google_sheet_id, "noise-id");
  const wbgt = onboardingDraftFromCanonicalProject(onboardingFor("wbgt")!, project);
  assert.equal(wbgt.monthly_sheet_id, "wbgt-id");
});

test("a new project starts with the delivery URLs deployment already dictates", () => {
  // The three proxy URLs are a property of the listener family, not the site —
  // the importer already overrode legacy row values with them — so typing them
  // per project was only a chance to mistype one.
  const env = {
    DEFAULT_LAMBDA_URL_SEND: "https://send.example/send-message",
    DEFAULT_LAMBDA_URL_REPLY: "https://reply.example/reply-message",
    DEFAULT_LAMBDA_URL_IMAGE: "https://doc.example/send-document",
  };
  const seeded = blankCanonicalProjectDraft(env);
  assert.equal(seeded.send_message_url, "https://send.example/send-message");
  assert.equal(seeded.reply_message_url, "https://reply.example/reply-message");
  assert.equal(seeded.send_document_url, "https://doc.example/send-document");
  // Everything else is still blank: this seeds delivery wiring, not identity.
  assert.equal(seeded.primary_alias, "");
  assert.equal(seeded.site_address, null);

  // An unset variable leaves the field blank rather than writing "undefined",
  // so a half-configured deployment degrades to typing them by hand.
  const partial = blankCanonicalProjectDraft({ DEFAULT_LAMBDA_URL_SEND: "https://send.example/send-message" });
  assert.equal(partial.send_message_url, "https://send.example/send-message");
  assert.equal(partial.reply_message_url, null);
  assert.equal(blankCanonicalProjectDraft({}).send_message_url, null);

  // The importer and the new-project form read the same three variables, so a
  // renamed variable cannot fix one path and quietly miss the other.
  assert.deepEqual(canonicalDeliveryDefaults(env), {
    send_message_url: env.DEFAULT_LAMBDA_URL_SEND,
    reply_message_url: env.DEFAULT_LAMBDA_URL_REPLY,
    send_document_url: env.DEFAULT_LAMBDA_URL_IMAGE,
  });
});

test("the registry search matches what the card shows, and nothing it hides", () => {
  const project: CanonicalProject = {
    id: "id-1",
    primary_alias: "TJR",
    alternate_aliases: ["Tanjong Rhu"],
    service_aliases: { wbgt: "TJR-W" } as CanonicalProject["service_aliases"],
    company: "Wohhup",
    site_name: "Tanjong Rhu Site",
    site_address: "1 Tan Boon Chong Ave",
    latitude: 1.315753,
    longitude: 103.788885,
    safety_workbook_id: "sheet-abc",
    manpower_workbook_id: null,
    noise_workbook_id: null,
    wbgt_workbook_id: null,
    send_message_url: null,
    reply_message_url: null,
    send_document_url: null,
    whatsapp_instance_name: null,
    whatsapp_client_id: null,
    timezone: null,
    public_holiday_region: null,
    general_notes: "internal note",
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
  };

  // Every field the card renders is findable, including the service alias.
  for (const query of ["tjr", "Tanjong Rhu", "TJR-W", "wohhup", "tan boon"]) {
    assert.equal(canonicalProjectMatches(project, query), true, `${query} should match`);
  }
  // Blank shows everything rather than nothing.
  assert.equal(canonicalProjectMatches(project, "   "), true);
  // Notes and workbook ids are not on the card, so they must not match — a hit
  // with no visible cause reads as a broken filter.
  assert.equal(canonicalProjectMatches(project, "internal note"), false);
  assert.equal(canonicalProjectMatches(project, "sheet-abc"), false);
  assert.equal(canonicalProjectMatches(project, "zzzz"), false);

  // The map link is the dashboard's, built from the stored pair.
  assert.equal(
    canonicalProjectMapHref(project),
    "https://www.google.com/maps?q=1.315753%2C103.788885",
  );
  // A half-populated pair gets no link rather than a pin at the equator.
  assert.equal(canonicalProjectMapHref({ ...project, longitude: null }), null);
  assert.equal(canonicalProjectMapHref({ ...project, latitude: null }), null);
});
