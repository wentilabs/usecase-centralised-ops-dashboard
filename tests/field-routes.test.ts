import assert from "node:assert/strict";
import test from "node:test";

import { EVERY_OUTBOUND_ROUTE, bindingsFor, isDeliveryPlumbing, routeHint, routesForField } from "../lib/field-routes";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { buildFieldSpec } from "../lib/field-spec";
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

test("a column read by two endpoints names both", () => {
  // Site hours gate the hourly report and the 5-minute alert alike.
  assert.deepEqual(routesForField("wbgt", "site_hours_start"), ["POST /api/wbgt-hourly", "POST /api/wbgt-5min"]);
  // `four_hourly` is named in two SEPARATE bindings, so this also covers the
  // merge across bindings rather than within one.
  assert.deepEqual(routesForField("haze", "four_hourly"), ["POST /api/haze-hourly", "POST /api/haze-kickoff"]);

  // No column currently lands the same route in two bindings, so the de-dup in
  // `routesForField` is defensive and this only checks it is not making things
  // worse. Said plainly rather than dressed up as coverage it does not have.
  for (const service of SERVICE_KEYS) {
    for (const binding of bindingsFor(service)) {
      for (const column of binding.columns) {
        const routes = routesForField(service, column);
        assert.deepEqual(routes, [...new Set(routes)], `${service}.${column} lists a route twice`);
      }
    }
  }
});

test("the routes and the preview flag reach the field spec itself", () => {
  // Carried on the field rather than looked up beside it, so the editor, the
  // create dialog and an agent reading getSchema all answer from one place.
  const spec = buildFieldSpec("noise", {
    enable_half_hourly: { type: "boolean", format: "boolean", enum: null, default: null },
    five_min_formatter: { type: "string", format: "text", enum: null, default: null },
    company: { type: "string", format: "text", enum: null, default: null },
  });
  assert.deepEqual(spec.fields.enable_half_hourly?.routes, ["POST /api/noise-half-hourly"]);
  assert.equal(spec.fields.enable_half_hourly?.hasPreview, false);
  // A formatter with a real preview says so, which is what lets a reader know
  // the `?` button is worth pressing before pressing it.
  assert.equal(spec.fields.five_min_formatter?.hasPreview, true);
  // And a labelling column carries neither.
  assert.deepEqual(spec.fields.company?.routes, []);
  assert.equal(spec.fields.company?.hasPreview, false);
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

test("multiple routes are stacked, not joined into one wrapping line", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const component = await readFile(resolve("components/RouteHint.tsx"), "utf8");

  // Three of the Issue Chaser columns name three endpoints each. Joined with a
  // separator they wrapped mid-path — `POST /api/past-days-company-safety-`
  // ending one row and `summary` starting the next — which is harder to read
  // than no path at all.
  assert.match(component, /routes\.map\(/, "each route needs its own row");
  // The row's text is the single route from the map, never the joined list.
  // `routes.join` is still allowed — the tooltip uses it — so this checks what
  // is RENDERED rather than banning the word.
  assert.match(component, /↳ \{route\}/, "a row must print one route, not the list");
  assert.doesNotMatch(component, /↳ \{routes\.join/, "joining into the row is what made it wrap");
  // A row either fits or overflows visibly; it must never be broken in half.
  assert.match(component, /whitespace-nowrap/);

  // The column that proves it: one field, three separate endpoints.
  assert.equal(routesForField("issueChaser", "summary_days").length, 3);
});

test("the all-clear mention switch is hidden until warnings are on", async () => {
  // On its own it changes nothing anyone would want: `shouldMentionPocs` gates
  // it on the POC phone list, and the CHECK only demands that list when the
  // WARNING flag is on — so with warnings off there is nobody to tag.
  const spec = buildFieldSpec("lightning", {
    enable_red_band_poc_mentions: { type: "boolean", format: "boolean", enum: null, default: null },
    enable_green_band_poc_mentions: { type: "boolean", format: "boolean", enum: null, default: null },
  });
  assert.deepEqual(spec.fields.enable_green_band_poc_mentions?.showIf, {
    field: "enable_red_band_poc_mentions",
    equals: true,
  });
  // The switch it depends on is not itself conditional, or neither would show.
  assert.equal(spec.fields.enable_red_band_poc_mentions?.showIf, null);
});
