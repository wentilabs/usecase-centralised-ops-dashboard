import assert from "node:assert/strict";
import test from "node:test";

import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  annotationsFor,
  inputSchemaFor,
  mcpTools,
  missingRequired,
  negotiateProtocol,
  toCallPlan,
} from "../lib/mcp";
import { openapiDocument } from "../lib/openapi";

/**
 * The MCP surface is derived from the OpenAPI document, so most of what could go
 * wrong is a bad derivation rather than a missing entry. These pin the parts a
 * model's behaviour actually depends on: the safety annotations, the flattened
 * argument schema, and that a call maps back to the right HTTP request.
 */

test("every documented operation becomes exactly one tool", () => {
  const operationIds = Object.values(openapiDocument.paths as Record<string, Record<string, { operationId?: string }>>)
    .flatMap((item) => Object.values(item))
    .map((op) => op.operationId)
    .filter(Boolean)
    .sort();
  assert.deepEqual(mcpTools().map((t) => t.name), operationIds);
});

test("the dangerous tool is the one marked dangerous", () => {
  // MCP clients surface these before calling, and some gate on them. runJob can
  // make a service send WhatsApp messages to a live construction site.
  const byName = Object.fromEntries(mcpTools().map((t) => [t.name, t.annotations]));

  assert.equal(byName.runJob.destructiveHint, true, "runJob must be flagged destructive");
  assert.equal(byName.runJob.readOnlyHint, false);
  assert.equal(byName.runJob.idempotentHint, false, "calling a job twice acts twice");
  assert.equal(byName.runJob.openWorldHint, true);

  // Nothing else claims to be destructive.
  const destructive = Object.entries(byName).filter(([, a]) => a.destructiveHint).map(([n]) => n);
  assert.deepEqual(destructive, ["runJob"]);

  // A PATCH is idempotent even though it changes production — the same write
  // twice leaves the same row. The description carries the warning, not the flag.
  assert.equal(byName.updateProjectConfig.idempotentHint, true);
  assert.equal(byName.updateProjectConfig.readOnlyHint, false);
});

test("every GET is read-only and every non-GET is not", () => {
  for (const [path, item] of Object.entries(openapiDocument.paths as Record<string, Record<string, { operationId?: string }>>)) {
    for (const [method, op] of Object.entries(item)) {
      if (!op?.operationId) continue;
      const annotations = annotationsFor(path, method, op as never);
      assert.equal(annotations.readOnlyHint, method === "get", `${method} ${path}`);
    }
  }
});

test("arguments are flattened, and the schema is JSON Schema 2020-12", () => {
  // A model handles {"service": …, "changes": …} far better than a nested
  // {"path": {...}, "body": {...}}.
  const patch = openapiDocument.paths["/api/config/{service}/{rowId}"].patch;
  const schema = inputSchemaFor(patch as never);
  const properties = schema.properties as Record<string, unknown>;

  assert.ok(properties.service, "path parameter is present");
  assert.ok(properties.rowId, "path parameter is present");
  assert.ok(properties.changes, "body property is present alongside it");
  assert.deepEqual(schema.required, ["service", "rowId", "changes"]);
  assert.equal(schema.additionalProperties, false, "a model must not invent fields");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
});

test("a tool call maps back to the right HTTP request", () => {
  const plan = toCallPlan("updateProjectConfig", {
    service: "haze",
    rowId: "AST",
    changes: { enabled: false },
    note: "why",
  })!;
  assert.equal(plan.method, "PATCH");
  assert.equal(plan.path, "/api/config/haze/AST");
  assert.deepEqual(plan.body, { changes: { enabled: false }, note: "why" });
  assert.deepEqual(plan.query, {});
});

test("path parameters are encoded, so a code with a space cannot break the URL", () => {
  // "CR 106" is a real WBGT project code.
  const plan = toCallPlan("updateProjectConfig", { service: "wbgt", rowId: "CR 106", changes: {} })!;
  assert.equal(plan.path, "/api/config/wbgt/CR%20106");
});

test("query parameters go to the query string, not the body", () => {
  const plan = toCallPlan("geocodeAddress", { q: "068914" })!;
  assert.equal(plan.method, "GET");
  assert.deepEqual(plan.query, { q: "068914" });
  assert.equal(plan.body, null);
});

test("an argument the operation does not declare is dropped, not forwarded", () => {
  // A model that invents a field must not have it reach the database.
  const plan = toCallPlan("updateProjectConfig", {
    service: "haze",
    rowId: "AST",
    changes: {},
    dropTable: "yes",
  })!;
  assert.equal("dropTable" in (plan.body ?? {}), false);
  assert.equal(plan.path.includes("dropTable"), false);
});

test("an unknown tool has no plan", () => {
  assert.equal(toCallPlan("deleteEverything", {}), null);
});

test("missing required arguments are named before the request is made", () => {
  // `job` is a required path parameter, so it is missing too — the flattened
  // schema makes path and body arguments indistinguishable to the caller, which
  // is the point.
  assert.deepEqual(missingRequired("runJob", { projectCode: "ZRA" }).sort(), ["endDate", "job", "startDate"]);
  assert.deepEqual(missingRequired("runJob", { job: "wbgt-fill", projectCode: "ZRA", startDate: "2026-08-01", endDate: "2026-08-02" }), []);
  // A blank string is missing, not present.
  assert.deepEqual(missingRequired("geocodeAddress", { q: "" }), ["q"]);
});

test("protocol negotiation echoes a supported revision and falls back otherwise", () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    assert.equal(negotiateProtocol(version), version);
  }
  assert.equal(negotiateProtocol("1999-01-01"), LATEST_PROTOCOL_VERSION);
  assert.equal(negotiateProtocol(undefined), LATEST_PROTOCOL_VERSION);
});

test("every tool carries a description long enough to act on", () => {
  for (const tool of mcpTools()) {
    assert.ok(tool.title.length > 8, `${tool.name} needs a title`);
    // Summary plus description — a client may show only one.
    assert.ok(tool.description.length > 80, `${tool.name} needs a real description`);
    assert.ok(tool.description.startsWith(tool.title), `${tool.name} should lead with its summary`);
  }
});
