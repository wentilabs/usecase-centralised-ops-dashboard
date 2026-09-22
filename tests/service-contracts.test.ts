import assert from "node:assert/strict";
import { NON_DELIVERY_CHAT_COLUMNS, groupColumnsFor } from "../lib/card-summary/groups";
import type { ServiceKey } from "../lib/services";
import test from "node:test";

import lock from "../contracts/service-contract.lock.json";
import { buildFieldSpec } from "../lib/field-spec";
import { SERVICE_CONTRACTS, contractReadonlyFields } from "../lib/service-contracts";

test("the vendored Haze contract identifies an immutable upstream revision", () => {
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.services.haze.repository, "wentilabs/usecase-haze-alerts");
  assert.equal(lock.services.haze.branch, "main");
  assert.match(lock.services.haze.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.haze.path, "contracts/service.contract.json");
  assert.equal(lock.services.haze.vendoredPath, "contracts/services/haze.contract.json");
});

test("the vendored Ailytics contract identifies an immutable upstream revision", () => {
  assert.equal(lock.services.ailytics.repository, "wentilabs/mdw-lambda-ailytics");
  // Repinned to main on 2026-09-18: the refactor branch merged, and main is
  // where the Telegram group discovery inbox landed.
  assert.equal(lock.services.ailytics.branch, "main");
  assert.match(lock.services.ailytics.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.ailytics.vendoredPath, "contracts/services/ailytics.contract.json");
});

test("the vendored Subcon Activities contract identifies an immutable upstream revision", () => {
  assert.equal(lock.services.subcon.repository, "wentilabs/usecase-wohhup-coy-housekeeping-waterparade");
  assert.equal(lock.services.subcon.localDirectory, "usecase-subcon-manpower-activities");
  assert.match(lock.services.subcon.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.subcon.vendoredPath, "contracts/services/subcon.contract.json");
});

test("the vendored Lightning contract identifies an immutable upstream revision", () => {
  assert.equal(lock.services.lightning.repository, "wentilabs/usecase-lightning-alerts");
  assert.match(lock.services.lightning.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.lightning.vendoredPath, "contracts/services/lightning.contract.json");
});

test("the vendored Issue Chaser contract identifies an immutable upstream revision", () => {
  assert.equal(lock.services.issueChaser.repository, "wentilabs/usecase-issue-chaser");
  assert.match(lock.services.issueChaser.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.issueChaser.vendoredPath, "contracts/services/issue-chaser.contract.json");
});

test("the vendored Noise contract identifies an immutable upstream revision", () => {
  assert.equal(lock.services.noise.repository, "wentilabs/usecase-wohhup-noise-meter-alerts");
  assert.match(lock.services.noise.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.noise.vendoredPath, "contracts/services/noise.contract.json");
});

test("the vendored WBGT contract identifies an immutable upstream revision", () => {
  assert.equal(lock.services.wbgt.repository, "wentilabs/usecase-wohhup-wbgt-alerts");
  assert.match(lock.services.wbgt.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.services.wbgt.vendoredPath, "contracts/services/wbgt.contract.json");
});

test("every service pins its SQL evolution plan to the same immutable revision", () => {
  for (const [key, entry] of Object.entries(lock.services)) {
    assert.equal(entry.sqlPath, "supabase/migration-plan.json", `${key} SQL source path drifted`);
    assert.match(entry.vendoredSqlPath, /^contracts\/sql\/.+\.migration-plan\.json$/);
  }
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

test("Ailytics records its externally visible routes and discovery authentication", () => {
  assert.deepEqual(
    SERVICE_CONTRACTS.ailytics.routes.map(({ method, path, kind, authentication }) => ({ method, path, kind, authentication })),
    [
      { method: "GET", path: "/version", kind: "diagnostic", authentication: "none" },
      { method: "POST", path: "/get-supabase-configs", kind: "diagnostic", authentication: "none" },
      // The inbox returns chat identities and must not be publicly enumerable.
      { method: "POST", path: "/get-telegram-group-discoveries", kind: "diagnostic", authentication: "lambda-auth" },
      { method: "POST", path: "/telegram-webhook", kind: "webhook", authentication: "none" },
      { method: "POST", path: "/ailytics-safety/whatsapp-events", kind: "webhook", authentication: "none" },
      { method: "POST", path: "/ailytics-safety/status-summary", kind: "scheduled", authentication: "none" },
      { method: "POST", path: "/ailytics-safety/yesterday-24h-summary", kind: "scheduled", authentication: "none" },
      { method: "POST", path: "/ailytics-safety/retry-pending-deliveries", kind: "scheduled", authentication: "none" },
    ],
  );
});

test("Subcon Activities pins all five external schedules and its webhook", () => {
  const routes = SERVICE_CONTRACTS.subcon.routes;
  assert.equal(routes.length, 6);
  assert.equal(routes.filter((route) => route.kind === "scheduled").length, 5);
  assert.ok(routes.some((route) => route.path === "/housekeeping-intake" && route.kind === "webhook"));
  assert.ok(routes.every((route) => route.authentication === "none"));
});

test("Lightning distinguishes optional service auth, SMS HMAC, and public reads", () => {
  const byPath = Object.fromEntries(SERVICE_CONTRACTS.lightning.routes.map((route) => [route.path, route]));
  assert.equal(byPath["/api/lightning-tick"].authentication, "optional-service-key");
  assert.equal(byPath["/api/lightning-kickoff"].kind, "scheduled");
  assert.equal(byPath["/api/lightning-sms"].authentication, "sms-hmac");
  assert.equal(byPath["/api/lightning-report"].authentication, "none");
});

test("Issue Chaser marks only its token-aware operator routes as optional auth", () => {
  assert.deepEqual(
    SERVICE_CONTRACTS.issueChaser.routes
      .filter((route) => route.authentication === "optional-service-key")
      .map((route) => route.path),
    [
      "/api/sync-novade-names",
      // aa3c4d1 — the photo-link refresh HALO drives from the Chaser action row.
      "/api/refresh-safety-image-links",
      // 91fbe8b — the company-name sync beside it.
      "/api/sync-company-names",
      "/api/issue-chaser-project-check",
      "/api/issue-chaser-operator-preview",
      "/api/issue-chaser-operator-send",
    ],
  );
});

test("Noise pins all sixteen open routes and distinguishes scheduled from operator jobs", () => {
  const routes = SERVICE_CONTRACTS.noise.routes;
  assert.equal(routes.length, 16);
  assert.ok(routes.every((route) => route.authentication === "none"));
  assert.equal(routes.find((route) => route.path === "/api/noise-sheet-export")?.kind, "operator");
  assert.equal(routes.find((route) => route.path === "/api/noise-hourly")?.kind, "scheduled");
});

test("WBGT pins cron paths while separating HMAC ingress from intentionally open routes", () => {
  const routes = SERVICE_CONTRACTS.wbgt.routes;
  const byPath = Object.fromEntries(routes.map((route) => [route.path, route]));
  assert.equal(routes.length, 16);
  assert.equal(byPath["/api/wbgt-telegram-external-channels"].authentication, "required-hmac");
  assert.equal(byPath["/api/wbgt-hourly"].authentication, "none");
  assert.equal(byPath["/api/water-parade-reminder"].kind, "scheduled");
  // 49c6642. Scheduled like the reminder, and open like the rest of the cron
  // surface — it decides for itself whether the configured hour has come, so
  // the hourly wake-up carries no argument worth signing.
  assert.equal(byPath["/api/water-parade-daily-summary"].kind, "scheduled");
  assert.equal(byPath["/api/water-parade-daily-summary"].authentication, "none");
  assert.equal(byPath["/api/wbgt/readings"].kind, "read");
});

test("every contracted field carries the semantic metadata HALO needs", () => {
  for (const [service, contract] of Object.entries(SERVICE_CONTRACTS)) {
    const fields = contract.configuration.fields;
    assert.ok(Object.keys(fields).length > 0);
    for (const [name, field] of Object.entries(fields)) {
      assert.ok(field.label, `${service}.${name} has no label`);
      assert.ok(field.help, `${service}.${name} has no help`);
      assert.ok(field.group, `${service}.${name} has no group`);
      assert.ok(field.role, `${service}.${name} has no role`);
      assert.equal(typeof field.mutable, "boolean", `${service}.${name} has no ownership`);
    }
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

test("Ailytics keeps UUID and business identity read-only without mislabelling its intake switch", () => {
  const spec = buildFieldSpec("ailytics", {
    id: { type: "uuid" },
    project_code: { type: "text" },
    enabled: { type: "boolean" },
  });
  assert.equal(spec.fields.id.readonly, true);
  assert.equal(spec.fields.project_code.readonly, true);
  assert.match(spec.fields.enabled.help, /Telegram intake/);
  assert.match(spec.fields.enabled.help, /existing issues can still be closed/i);
});

test("Subcon Activities keeps its two independent switches and bidirectional group meaning explicit", () => {
  const spec = buildFieldSpec("subcon", {
    enabled: { type: "boolean" },
    enable_housekeeping: { type: "boolean" },
    safety_group_ids: { type: "text" },
  });
  assert.match(spec.fields.enabled.help, /intake/i);
  assert.match(spec.fields.enable_housekeeping.help, /whole housekeeping feature/i);
  assert.match(spec.fields.safety_group_ids.help, /Inbound:/i);
  assert.match(spec.fields.safety_group_ids.help, /Outbound:/i);
});

test("Lightning contract semantics preserve the counterintuitive safety levers", () => {
  const spec = buildFieldSpec("lightning", {
    ground_uncertainty_m: { type: "integer" },
    amber_enabled: { type: "boolean" },
    config_version: { type: "integer" },
    red_detection_types: { type: "array" },
  });
  assert.match(spec.fields.ground_uncertainty_m.help, /more (stops|qualifiers)/i);
  assert.match(spec.fields.amber_enabled.help, /(straight|directly) to SAFE/i);
  assert.match(spec.fields.config_version.help, /same (save|write)/i);
  assert.deepEqual(spec.fields.red_detection_types.options, ["G", "C"]);
});

test("Issue Chaser keeps origin routing, delivery-only mutes, and write-capable sync explicit", () => {
  const spec = buildFieldSpec("issueChaser", {
    send_to_originating_groups: { type: "boolean" },
    remove_sunday_notifications: { type: "boolean" },
    novade_name_sync_enabled: { type: "boolean" },
  });
  assert.match(spec.fields.send_to_originating_groups.help, /exactly one/i);
  assert.match(spec.fields.remove_sunday_notifications.help, /(delivery|outbound)/i);
  assert.match(spec.fields.novade_name_sync_enabled.help, /(write|replace)/i);
});

test("Noise contract semantics cover quoted columns, demand-driven scraping, and message-only filters", () => {
  const assessment = 'assessment_readings_mm_array("35,45,55")';
  const spec = buildFieldSpec("noise", {
    lambda_url: { type: "text" },
    noise_meters_included: { type: "text" },
    [assessment]: { type: "text" },
  });
  assert.match(spec.fields.lambda_url.help, /(scrape demand|messages stop being stored)/i);
  assert.match(spec.fields.noise_meters_included.help, /(client-facing|outbound)/i);
  assert.equal(spec.fields[assessment].label, "Minute marks");
});

test("WBGT contract protects job state and exposes its coupled cadence semantics", () => {
  const spec = buildFieldSpec("wbgt", {
    enable_hourly: { type: "boolean" },
    top_of_hour_band: { type: "text" },
    last_5min_alert_level: { type: "text" },
    five_min_alert_threshold: { type: "text" },
  });
  assert.match(spec.fields.enable_hourly.help, /(sub-hour|intermittent)/i);
  assert.equal(spec.fields.top_of_hour_band.readonly, true);
  assert.equal(spec.fields.last_5min_alert_level.readonly, true);
  assert.deepEqual(spec.fields.five_min_alert_threshold.options, ["yellow", "orange", "red"]);
});

test("every destination a service contract declares is a chip on the card", () => {
  // The gap this closes: lightning's `sms_whatsapp_group_id` reached the live
  // table and the editor, and never reached the card — so a project forwarding
  // SMS to a separate group looked like it sent everything to one place. The
  // same was true of noise's expiry group, ailytics' yesterday summary and all
  // five of issue-chaser's summary destinations.
  //
  // Checked against the vendored contracts rather than the live database, so
  // it runs offline and fails when a contract is refreshed with a new one.
  const missing: string[] = [];
  for (const [service, contract] of Object.entries(SERVICE_CONTRACTS)) {
    const declared = Object.keys(contract.configuration.fields);
    const chips = new Set(groupColumnsFor(service as ServiceKey).map((entry) => entry.column));
    for (const column of declared) {
      // A destination by name: something that holds one or more group ids.
      if (!/(^|_)(wa_group|whatsapp_group|group_id|group_ids|gid)s?$/.test(column)) continue;
      if (chips.has(column)) continue;
      if (NON_DELIVERY_CHAT_COLUMNS[column]) continue;
      missing.push(`${service}.${column}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `these hold group ids but are neither a delivery chip nor listed as deliberately not one: ${missing.join(", ")}`,
  );
});

test("a column excused from the card says why", () => {
  // An empty reason would let the exclusion list become a way to silence this
  // check without deciding anything.
  for (const [column, reason] of Object.entries(NON_DELIVERY_CHAT_COLUMNS)) {
    assert.ok(reason.length > 20, `${column} needs a real reason, got "${reason}"`);
  }
});
