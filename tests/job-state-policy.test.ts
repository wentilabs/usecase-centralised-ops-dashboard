import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

test("the purge SQL names exactly the job-state columns, and can only delete machine rows", async () => {
  const sql = await readFile(resolve("supabase/purge_job_state_audit.sql"), "utf8");

  // Both the preview and the delete carry the column list, and each must match
  // JOB_STATE_COLUMNS exactly: a column missing here is churn that is never
  // purged, one extra here is a real edit that gets deleted.
  const lists = [...sql.matchAll(/k not in \(([^)]*)\)/g)].map((m) =>
    (m[1].match(/'[a-z0-9_]+'/g) ?? []).map((q) => q.slice(1, -1)).sort(),
  );
  assert.equal(lists.length, 2, "preview and delete must each carry the list");
  for (const list of lists) {
    assert.deepEqual(list, [...directColumns].sort());
  }

  // The guards that stop a human edit from being deleted. Dropping any one of
  // them widens the delete past machine-written rows.
  const deleteStatement = sql.slice(sql.indexOf("delete from ops.config_audit"));
  for (const guard of ["actor_email is null", "note is null", "not exists", "changes <> '{}'::jsonb"]) {
    assert.ok(deleteStatement.includes(guard), `the delete lost its guard: ${guard}`);
  }
});
