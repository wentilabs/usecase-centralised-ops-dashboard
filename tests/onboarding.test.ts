import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInsertRow,
  wbgtTableForProject,
  missingEnvDefaults,
  onboardingFor,
  prefillDefaults,
  resolveValue,
  validateDraft,
} from "../lib/onboarding";
import type { ProjectConfigRow } from "../lib/services";

/**
 * Onboarding is the only INSERT in the app, and the ailytics table punishes the
 * obvious implementation twice: five NOT NULL columns that are routinely unknown,
 * and a composite unique key built from two of them.
 */

const ailytics = onboardingFor("ailytics")!;

const row = (over: Partial<ProjectConfigRow>): ProjectConfigRow =>
  ({
    project_code: "EXISTING",
    telegram_chat_id: "-100999",
    upstream_bot_username: "ailytics_bot",
    ...over,
  }) as ProjectConfigRow;

const complete = {
  project_code: "NEW",
  spreadsheet_id: "S".repeat(30),
  lambda_url: "https://listener.example/send-message",
};

test("onboarding is offered for ailytics and wbgt only", () => {
  assert.ok(onboardingFor("ailytics"));
  assert.ok(onboardingFor("wbgt"));
  for (const service of ["noise", "haze", "lightning", "subcon"] as const) {
    assert.equal(onboardingFor(service), null, service);
  }
});

test("a blank NOT NULL column is stored as empty string, never null", () => {
  // This is the distinction that makes a draft row legal. Writing null instead
  // would be rejected by Postgres on five columns.
  const built = buildInsertRow(ailytics, complete, {});
  for (const column of [
    "telegram_chat_id",
    "upstream_bot_username",
    "instance_name",
    "client_id",
    "whatsapp_group_ids",
  ]) {
    assert.equal(built[column], "", `${column} must be "" when unknown`);
  }
  // Nullable columns keep null, so "unset" stays distinguishable from "blank".
  assert.equal(built.expected_chat_title, null);
  assert.equal(built.lambda_url_image, null);
});

test("the row is always created disabled", () => {
  assert.equal(buildInsertRow(ailytics, complete, {}).enabled, false);
  // Not settable from the draft either.
  assert.equal(buildInsertRow(ailytics, { ...complete, enabled: "true" }, {}).enabled, false);
});

test("tab names follow the (CODE) convention, not the Postgres defaults", () => {
  // TEST and ZRA use this shape; the column default is the older
  // "cctv safety activity history", so the value is written explicitly.
  const built = buildInsertRow(ailytics, { ...complete, project_code: "ZRB" }, {});
  assert.equal(built.activity_history_tab, "(ZRB) CCTV History");
  assert.equal(built.safety_sheet_tab, "(ZRB) CCTV Safety Sheet");
  // Unlike every other field, a typed value does NOT win here — the tab name is
  // computed. See "the tab names are computed and cannot be overridden".
});

test("the three lambda URLs come from env, and typing beats the default", () => {
  const env = {
    DEFAULT_LAMBDA_URL_SEND: "https://env.example/send-message",
    DEFAULT_LAMBDA_URL_REPLY: "https://env.example/reply-message",
    DEFAULT_LAMBDA_URL_IMAGE: "https://env.example/send-document",
  };
  const built = buildInsertRow(ailytics, { project_code: "NEW", spreadsheet_id: "S".repeat(30) }, env);
  assert.equal(built.lambda_url, "https://env.example/send-message");
  assert.equal(built.reply_lambda_url, "https://env.example/reply-message");
  assert.equal(built.lambda_url_image, "https://env.example/send-document");

  const typed = buildInsertRow(ailytics, { ...complete, reply_lambda_url: "https://typed/x" }, env);
  assert.equal(typed.reply_lambda_url, "https://typed/x");

  assert.deepEqual(missingEnvDefaults(ailytics, env), []);
  assert.deepEqual(missingEnvDefaults(ailytics, {}), [
    "DEFAULT_LAMBDA_URL_SEND",
    "DEFAULT_LAMBDA_URL_REPLY",
    "DEFAULT_LAMBDA_URL_IMAGE",
  ]);
});

test("timezone falls back to Asia/Singapore", () => {
  assert.equal(buildInsertRow(ailytics, complete, {}).timezone, "Asia/Singapore");
});

test("a duplicate project code is refused, case-insensitively", () => {
  const existing = [row({ project_code: "ZRA" })];
  assert.ok(validateDraft(ailytics, { ...complete, project_code: "zra" }, existing).some((p) => /already exists/.test(p)));
  assert.deepEqual(validateDraft(ailytics, complete, existing), []);
});

test("only one draft may leave both halves of the unique key blank", () => {
  // The trap: Postgres has `unique (telegram_chat_id, upstream_bot_username)`,
  // so a second all-blank draft is a constraint violation, not a valid row.
  const existingDraft = [row({ project_code: "DRAFT1", telegram_chat_id: "", upstream_bot_username: "" })];
  const problems = validateDraft(ailytics, complete, existingDraft);
  assert.ok(problems.some((p) => /DRAFT1 is already a draft/.test(p)), problems.join(" | "));

  // Filling in either half clears it.
  assert.deepEqual(
    validateDraft(ailytics, { ...complete, telegram_chat_id: "-100123" }, existingDraft),
    [],
  );
});

test("a real duplicate pair is reported as a collision, not as a draft clash", () => {
  const existing = [row({ project_code: "ZRA", telegram_chat_id: "-100999", upstream_bot_username: "ailytics_bot" })];
  const problems = validateDraft(
    ailytics,
    { ...complete, telegram_chat_id: "-100999", upstream_bot_username: "ailytics_bot" },
    existing,
  );
  assert.ok(problems.some((p) => /already uses that/.test(p)), problems.join(" | "));
});

test("required fields are named individually, and env defaults satisfy them", () => {
  const problems = validateDraft(ailytics, {}, []);
  assert.ok(problems.some((p) => /Project code is required/.test(p)));
  assert.ok(problems.some((p) => /Spreadsheet ID is required/.test(p)));
  // lambda_url is required but has an env default, so it only complains when the
  // env is absent — resolveValue is consulted, not the raw draft.
  assert.equal(resolveValue(ailytics.fields.find((f) => f.column === "lambda_url")!, {}, "X", {
    DEFAULT_LAMBDA_URL_SEND: "https://env/x",
  }), "https://env/x");
});

test("a project code that would break a sheet tab name is refused", () => {
  for (const bad of ["has space", "slash/es", "quote'", ""]) {
    assert.ok(
      validateDraft(ailytics, { ...complete, project_code: bad }, []).length,
      `${JSON.stringify(bad)} should be refused`,
    );
  }
  assert.deepEqual(validateDraft(ailytics, { ...complete, project_code: "CR-106_A" }, []), []);
});

test("the steps HALO cannot perform are carried on the definition", () => {
  // The row looks finished without them, so the dialog has to say so.
  assert.equal(ailytics.outsideHalo.length, 2);
  assert.ok(ailytics.outsideHalo.some((step) => /Editor/.test(step)), "sheet sharing needs Editor");
  assert.ok(ailytics.outsideHalo.some((step) => /adapter/i.test(step)));
});

test("the three proxy URLs come last, after every project-specific field", () => {
  // They are prefilled from env and rarely touched, so they belong at the end
  // rather than interrupting the fields someone actually types.
  const columns = ailytics.fields.map((f) => f.column);
  assert.deepEqual(columns.slice(-3), ["lambda_url", "reply_lambda_url", "lambda_url_image"]);
});

test("the tab names are computed and cannot be overridden by the draft", () => {
  // An editable box would let a row carry a tab name that the service then
  // creates as a *different* sheet from the one anyone expects.
  for (const column of ["activity_history_tab", "safety_sheet_tab"]) {
    const field = ailytics.fields.find((f) => f.column === column)!;
    assert.equal(field.computed, true, column);
  }
  const built = buildInsertRow(
    ailytics,
    { ...complete, project_code: "ZRB", activity_history_tab: "Hand typed", safety_sheet_tab: "Also typed" },
    {},
  );
  assert.equal(built.activity_history_tab, "(ZRB) CCTV History");
  assert.equal(built.safety_sheet_tab, "(ZRB) CCTV Safety Sheet");
});

test("prefill carries real values, and never a computed field", () => {
  const env = {
    DEFAULT_LAMBDA_URL_SEND: "https://env.example/send-message",
    DEFAULT_LAMBDA_URL_REPLY: "https://env.example/reply-message",
    DEFAULT_LAMBDA_URL_IMAGE: "https://env.example/send-document",
  };
  const prefill = prefillDefaults(ailytics, env);
  assert.equal(prefill.lambda_url, "https://env.example/send-message");
  assert.equal(prefill.reply_lambda_url, "https://env.example/reply-message");
  assert.equal(prefill.lambda_url_image, "https://env.example/send-document");
  assert.equal(prefill.timezone, "Asia/Singapore", "the literal fallback is prefilled too");
  // Computed fields depend on the project code, so they are not prefillable.
  assert.equal("activity_history_tab" in prefill, false);
  assert.equal("safety_sheet_tab" in prefill, false);
  // An unset env var contributes nothing rather than an empty string.
  assert.equal("lambda_url" in prefillDefaults(ailytics, {}), false);
});

// ---------------------------------------------------------------------------
// WBGT: three objects, not one.
// ---------------------------------------------------------------------------

const wbgt = onboardingFor("wbgt")!;

test("the readings table name matches lib/naming.js in the wbgt repo", () => {
  // Three implementations of this rule now exist — JS, SQL and here. A project
  // code that normalises differently would name a table the service cannot find.
  assert.equal(wbgtTableForProject("ZRA"), "zra_wbgt_data_hourly");
  assert.equal(wbgtTableForProject("CR 106"), "cr_106_wbgt_data_hourly");
  assert.equal(wbgtTableForProject("C991-SGB"), "c991_sgb_wbgt_data_hourly");
  assert.equal(wbgt.rpc?.expects("CR 106"), "cr_106_wbgt_data_hourly");
});

test("the readings table is created before the config row", () => {
  // Order matters: a config row pointing at a table that was never created is
  // the half-onboarded state the RPC-first sequence exists to avoid.
  assert.equal(wbgt.rpc?.fn, "ensure_project_readings_table");
  assert.deepEqual(wbgt.rpc?.args("ZRB"), { p_project_code: "ZRB" });
});

test("sensor fields never reach the config insert", () => {
  // sensor_label is a column of wbgt_sensors, not wbgt_project_configs.
  // Sending it would fail the row outright.
  const built = buildInsertRow(wbgt, { project_code: "ZRB", sensor_label: "WBGT ZRB (WC-20)" }, {});
  assert.equal("sensor_label" in built, false);
  assert.equal("site_name" in built, false);
  assert.equal(built.project_code, "ZRB");
  assert.equal(built.enabled, false, "wbgt.enabled defaults to TRUE in Postgres, so false must be explicit");
});

test("a blank sensor label becomes an obvious placeholder, not a plausible guess", () => {
  // Only CloudLynx knows the real label, and a plausible wrong one fails
  // silently — the scrape reports missing_configured_sensors and collects
  // nothing. So the placeholder is written to be unmistakable.
  const [row] = wbgt.companion!.build({}, "ZRB");
  assert.equal(row.project_code, "ZRB");
  assert.match(String(row.sensor_label), /set the CloudLynx label/);
  assert.equal(row.active, true);
  assert.equal(row.site_name, null);

  const [typed] = wbgt.companion!.build({ sensor_label: "WBGT ZRB (WC-20)", site_name: "Zion Road" }, "ZRB");
  assert.equal(typed.sensor_label, "WBGT ZRB (WC-20)");
  assert.equal(typed.site_name, "Zion Road");
});

test("the sensor row upserts on the key the table actually has", () => {
  assert.equal(wbgt.companion?.table, "wbgt_sensors");
  assert.equal(wbgt.companion?.onConflict, "project_code,sensor_label");
});

test("wbgt has no NOT NULL text column to fake, unlike ailytics", () => {
  // Every NOT NULL column on wbgt_project_configs has a default and there are no
  // CHECK constraints, so a draft row needs no empty-string convention.
  const notNullText = wbgt.fields.filter((f) => f.notNull && f.column !== "project_code" && f.column !== "source_type");
  assert.deepEqual(notNullText, [], "no wbgt field should need the empty-string treatment");
  assert.equal(wbgt.uniqueTogether, undefined, "and there is no composite unique key to pre-empt");
});

test("both onboarding flows name the steps HALO cannot perform", () => {
  for (const definition of [wbgt, onboardingFor("ailytics")!]) {
    assert.ok(definition.outsideHalo.length >= 2, definition.service);
    for (const step of definition.outsideHalo) assert.ok(step.length > 40, "steps must be actionable");
  }
  assert.ok(wbgt.outsideHalo.some((s) => /character-exactly/.test(s)), "the label trap must be stated");
});
