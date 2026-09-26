import { test } from "node:test";
import assert from "node:assert/strict";

import { dataHealthAvailability, healthBadge, latestSnapshots, validateHealthPolicyDraft } from "../lib/data-health";

test("data health policies begin disabled and require recipients before enabling", () => {
  const disabled = validateHealthPolicyDraft({
    canonical_project_id: "00000000-0000-4000-8000-000000000001",
    source_service: "wbgt",
  });
  assert.deepEqual(disabled.problems, []);
  assert.equal(disabled.draft?.enabled, false);

  const enabledWithoutRecipients = validateHealthPolicyDraft({
    canonical_project_id: "00000000-0000-4000-8000-000000000001",
    source_service: "wbgt",
    enabled: true,
    data_checks: ["staleness"],
    recipient_group_ids: [],
  });
  assert.match(enabledWithoutRecipients.problems.join(" "), /recipient/i);
});

test("provider acceptance remains distinct from delivery and read", () => {
  assert.deepEqual(healthBadge("provider_accepted"), {
    tone: "good",
    label: "Delivery: Provider accepted",
  });
});

test("unavailable Data Health storage remains neutral and newest snapshots win", () => {
  assert.deepEqual(dataHealthAvailability(new Error("406 PGRST106 schema is not exposed")), { available: false, reason: "not_configured" });
  const snapshots = latestSnapshots([
    { policy_id: "p1", data_outcome: "warn", delivery_outcome: "transport_failed", evaluated_at: "2026-09-26T01:00:00.000Z" },
    { policy_id: "p1", data_outcome: "good", delivery_outcome: "provider_accepted", evaluated_at: "2026-09-26T02:00:00.000Z" },
  ]);
  assert.equal(snapshots.get("p1")?.data_outcome, "good");
});
