import assert from "node:assert/strict";
import test from "node:test";

import { EVERY_OUTBOUND_ROUTE, bindingsFor, isDeliveryPlumbing, routeHint, routesForField } from "../lib/field-routes";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { SERVICE_KEYS } from "../lib/services";

/**
 * The registry names routes and columns that live in other repositories, so
 * both halves are checked against the pinned contract rather than trusted. A
 * route renamed upstream, or a column misremembered here, fails the build
 * instead of putting a confident wrong answer under a field label.
 */
test("every route named is a route its service's contract declares", () => {
  let checked = 0;
  for (const service of SERVICE_KEYS) {
    const contract = SERVICE_CONTRACTS[service];
    assert.ok(contract, `${service} has no pinned contract`);
    const declared = new Set(contract.routes.map((route) => `${route.method} ${route.path}`));

    for (const binding of bindingsFor(service)) {
      for (const route of binding.routes) {
        assert.ok(declared.has(route), `${service} binds a column to ${route}, which its contract does not declare`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 60, `only ${checked} route bindings — the registry emptied out`);
});

test("every column named is a column its service's contract declares", () => {
  for (const service of SERVICE_KEYS) {
    const fields = new Set(Object.keys(SERVICE_CONTRACTS[service]!.configuration.fields));
    for (const binding of bindingsFor(service)) {
      for (const column of binding.columns) {
        assert.ok(fields.has(column), `${service}.${column} is bound to a route but is not in the contract`);
      }
    }
  }
});

test("every service says something, and the busy ones say a lot", () => {
  for (const service of SERVICE_KEYS) {
    const bindings = bindingsFor(service);
    assert.ok(bindings.length > 0, `${service} has no route bindings at all`);
  }
  // The two services a newcomer is most likely to open first, and the two with
  // the most routes to get lost among.
  assert.ok(routesForField("noise", "enable_half_hourly").length > 0);
  assert.ok(routesForField("issueChaser", "daily_safety_chatgroup_summary_schedule").length > 0);
});

test("two switches that sit next to each other name different endpoints", () => {
  // The whole point. These read alike and are served by different Lambdas on
  // different schedules, and nothing in the names says so.
  assert.deepEqual(routesForField("noise", "enable_hourly"), ["POST /api/noise-hourly"]);
  assert.deepEqual(routesForField("noise", "enable_half_hourly"), ["POST /api/noise-half-hourly"]);
  assert.deepEqual(routesForField("noise", "enable_5min"), ["POST /api/noise-5min"]);

  // And the three summaries, which differ only by a word in the middle.
  assert.deepEqual(routesForField("issueChaser", "daily_safety_summary_enabled"), ["POST /api/past-days-safety-summary"]);
  assert.deepEqual(routesForField("issueChaser", "daily_safety_company_summary_enabled"), [
    "POST /api/past-days-company-safety-summary",
  ]);
  assert.deepEqual(routesForField("issueChaser", "daily_safety_chatgroup_summary_enabled"), [
    "POST /api/past-days-chatgroup-safety-summary",
  ]);
});

test("a column read by two endpoints names both, without repeating one", () => {
  // Site hours gate the hourly report and the 5-minute alert alike.
  assert.deepEqual(routesForField("wbgt", "site_hours_start"), ["POST /api/wbgt-hourly", "POST /api/wbgt-5min"]);
  // POC mentions appear in two bindings for WBGT; the same route must not be
  // listed twice because it was named in both.
  const poc = routesForField("wbgt", "poc_phone_numbers");
  assert.deepEqual(poc, [...new Set(poc)]);
  assert.equal(poc.length, 2);
});

test("delivery plumbing says every outbound route rather than listing fifteen", () => {
  for (const column of ["lambda_url", "instance_name", "client_id", "enabled"]) {
    assert.equal(isDeliveryPlumbing(column), true, `${column} should be plumbing`);
    assert.equal(routeHint("issueChaser", column), EVERY_OUTBOUND_ROUTE);
  }
  // A real destination is NOT plumbing — where a thing goes is specific.
  assert.equal(isDeliveryPlumbing("whatsapp_group_ids"), false);
});

test("a column with nothing useful to say says nothing", () => {
  // Labelling only. A route under it would be an invitation to read meaning
  // into a field that has none.
  assert.equal(routeHint("lightning", "company"), null);
  assert.equal(routeHint("wbgt", "timezone"), null);
  assert.equal(routeHint("noise", "project_code"), null);
});

test("the hint reads as one line, joined the same way everywhere", () => {
  assert.equal(routeHint("noise", "enable_hourly"), "POST /api/noise-hourly");
  assert.equal(routeHint("wbgt", "skip_lunch_hour"), "POST /api/wbgt-hourly · POST /api/wbgt-5min");
  // No base URL: which deployment it is changes nothing about which handler
  // reads the column.
  for (const service of SERVICE_KEYS) {
    for (const binding of bindingsFor(service)) {
      for (const route of binding.routes) {
        assert.doesNotMatch(route, /https?:\/\//, `${route} carries a base URL`);
        assert.match(route, /^(GET|POST|PUT|PATCH|DELETE) \//, `${route} is not METHOD /path`);
      }
    }
  }
});
