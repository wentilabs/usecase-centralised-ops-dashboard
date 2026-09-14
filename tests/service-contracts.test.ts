import assert from "node:assert/strict";
import test from "node:test";

import lock from "../contracts/service-contract.lock.json";
import { buildFieldSpec } from "../lib/field-spec";
import { SERVICE_CONTRACTS, contractReadonlyFields } from "../lib/service-contracts";

test("the vendored Haze contract identifies an immutable upstream revision", () => {
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.services.haze.repository, "wentilabs/usecase-haze-alerts");
  assert.equal(lock.services.haze.branch, "critical-refactor-for-maintainability");
  assert.match(lock.services.haze.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.haze.path, "contracts/service.contract.json");
  assert.equal(lock.services.haze.vendoredPath, "contracts/services/haze.contract.json");
});

test("the Haze route contract pins the externally configured endpoint surface", () => {
  assert.deepEqual(
    SERVICE_CONTRACTS.haze.routes.map(({ method, path, kind, authentication }) => ({ method, path, kind, authentication })),
    [
      { method: "POST", path: "/api/haze-ingest", kind: "scheduled", authentication: "none" },
      { method: "POST", path: "/api/haze-hourly", kind: "scheduled", authentication: "none" },
      { method: "POST", path: "/api/haze-kickoff", kind: "scheduled", authentication: "none" },
      { method: "POST", path: "/api/haze-retry", kind: "scheduled", authentication: "none" },
      { method: "POST", path: "/api/haze-report-now", kind: "operator", authentication: "none" },
      { method: "GET", path: "/api/haze-readings", kind: "read", authentication: "none" },
    ],
  );
});

test("every contracted field carries the semantic metadata HALO needs", () => {
  const fields = SERVICE_CONTRACTS.haze.configuration.fields;
  assert.ok(Object.keys(fields).length > 0);
  for (const [name, field] of Object.entries(fields)) {
    assert.ok(field.label, `${name} has no label`);
    assert.ok(field.help, `${name} has no help`);
    assert.ok(field.group, `${name} has no group`);
    assert.ok(field.role, `${name} has no role`);
    assert.equal(typeof field.mutable, "boolean", `${name} has no ownership`);
  }
});

test("service semantics enrich introspection without displacing HALO curation", () => {
  const spec = buildFieldSpec("haze", {
    project_code: { type: "text" },
    alert_only_when_at_least: { type: "text" },
    four_hourly: { type: "boolean" },
  });

  assert.equal(spec.fields.project_code.readonly, true, "contract-owned identity stays read-only");
  assert.deepEqual(spec.fields.alert_only_when_at_least.options, [
    "good",
    "moderate",
    "unhealthy",
    "very_unhealthy",
    "hazardous",
  ]);
  assert.equal(spec.fields.alert_only_when_at_least.widget, "select");
  assert.match(spec.fields.four_hourly.help, /08:00, 10:00/,
    "HALO's more detailed, operator-tested wording must continue to win");
});

test("the contract and local policy agree on Haze-owned columns", () => {
  assert.deepEqual(contractReadonlyFields("haze").sort(), ["created_at", "project_code", "updated_at"]);
});
