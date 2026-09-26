import { test } from "node:test";
import assert from "node:assert/strict";

import { healthBadge, validateHealthPolicyDraft } from "../lib/data-health";

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
