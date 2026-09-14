import assert from "node:assert/strict";
import test from "node:test";

import {
  JOB_STATE_COLUMNS as directColumns,
  auditChangesWithoutJobState as directFilter,
} from "../lib/job-state-policy";
import {
  JOB_STATE_COLUMNS as compatibilityColumns,
  auditChangesWithoutJobState as compatibilityFilter,
} from "../lib/field-spec";

test("field-spec keeps stable compatibility exports for job-state policy", () => {
  assert.strictEqual(compatibilityColumns, directColumns);
  assert.strictEqual(compatibilityFilter, directFilter);
});

test("job-state filtering preserves a real edit while removing machine churn", () => {
  const enabledChange = { from: false, to: true };
  assert.deepEqual(directFilter({
    enabled: enabledChange,
    top_of_hour_band: { from: "low", to: "high" },
    imported_at: { from: "old", to: "new" },
  }), { enabled: enabledChange });
});

test("job-state-only audit entries collapse to null", () => {
  assert.equal(directFilter({ last_5min_alert_at: { from: null, to: "now" } }), null);
});
