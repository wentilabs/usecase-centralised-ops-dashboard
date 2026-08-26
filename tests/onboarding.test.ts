import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInsertRow,
  noiseTableForProject,
  wbgtTableForProject,
  missingEnvDefaults,
  onboardingFor,
  prefillDefaults,
  resolveValue,
  validateDraft,
} from "../lib/onboarding";
import { CHAT_ID_COLUMNS } from "../lib/card-summary";
import { jobsForService } from "../lib/jobs";
import { SERVICE_KEYS } from "../lib/services";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";

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

test("every service now offers onboarding", () => {
  for (const key of SERVICE_KEYS) {
    assert.ok(onboardingFor(key), `${key} should offer onboarding`);
  }
});

test("the project-code rule follows the service, not HALO", () => {
  // One shared regex used to accept codes that Postgres then rejected.
  const haze = onboardingFor("haze")!;
  const lightning = onboardingFor("lightning")!;
  const wbgtDef = onboardingFor("wbgt")!;
  const ailyticsDef = onboardingFor("ailytics")!;

  // haze and lightning both CHECK ^[A-Z0-9][A-Z0-9-]{0,47}$ — no lowercase, no
  // underscores.
  for (const definition of [haze, lightning]) {
    assert.equal(definition.codePattern.test("ZRA"), true, definition.service);
    assert.equal(definition.codePattern.test("CR-106"), true, definition.service);
    assert.equal(definition.codePattern.test("zra"), false, `${definition.service} lowercase`);
    assert.equal(definition.codePattern.test("CR_106"), false, `${definition.service} underscore`);
  }

  // wbgt has no CHECK, but the table name must start with a letter.
  assert.equal(wbgtDef.codePattern.test("CR 106"), true, "wbgt allows the space it normalises away");
  assert.equal(wbgtDef.codePattern.test("106"), false, "a leading digit would break the table name");

  // ailytics constrains nothing at the database, so HALO is the only rule.
  assert.equal(ailyticsDef.codePattern.test("cr_106"), true);
});

test("a code the service would reject is caught before the insert", () => {
  const haze = onboardingFor("haze")!;
  const problems = validateDraft(
    haze,
    { project_code: "zra", latitude: "1.2792", longitude: "103.848" },
    [],
  );
  assert.ok(problems.some((p) => /not valid for haze/.test(p)), problems.join(" | "));
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

// ---------------------------------------------------------------------------
// haze and lightning: one insert each, but with real constraints.
// ---------------------------------------------------------------------------

const haze = onboardingFor("haze")!;
const lightning = onboardingFor("lightning")!;

test("haze derives the NEA region live, and marks it for review", () => {
  const field = haze.fields.find((f) => f.column === "nea_region")!;
  const derived = field.autofill!({ latitude: "1.4043", longitude: "103.9022" });
  assert.equal(derived?.value, "north", "Punggol is North, not the nearest centroid");
  assert.equal(derived?.review, true);

  // Editable, not computed — the source repo supports an explicit override.
  assert.equal(field.computed, undefined);
  assert.equal(field.autofill!({ latitude: "", longitude: "" }), null);
});

test("coordinates are validated as a pair, against the CHECK bounds", () => {
  for (const definition of [haze, lightning]) {
    const outside = validateDraft(
      definition,
      { project_code: "ZRA", latitude: "51.5", longitude: "-0.12", nea_region: "north", red_radius_m: "8000", amber_radius_m: "12000" },
      [],
    );
    assert.ok(outside.some((p) => /inside Singapore/.test(p)), definition.service);
  }
});

test("lightning requires both radii and defaults neither", () => {
  // The repo's own wizard calls them client-approved and refuses without them.
  const problems = validateDraft(
    lightning,
    { project_code: "ZRA", latitude: "1.2792", longitude: "103.848" },
    [],
  );
  assert.ok(problems.some((p) => /Red radius .* is required/.test(p)), problems.join(" | "));
  assert.ok(problems.some((p) => /Amber radius .* is required/.test(p)), problems.join(" | "));

  for (const field of ["red_radius_m", "amber_radius_m"]) {
    const entry = lightning.fields.find((f) => f.column === field)!;
    assert.equal(entry.fallback, undefined, `${field} must have no default`);
    assert.equal(entry.envDefault, undefined, `${field} must not come from env`);
  }
});

test("a radius outside its CHECK range is refused before the insert", () => {
  const base = { project_code: "ZRA", latitude: "1.2792", longitude: "103.848", amber_radius_m: "12000" };
  assert.ok(
    validateDraft(lightning, { ...base, red_radius_m: "200000" }, []).some((p) => /between 1 and 100000/.test(p)),
  );
  assert.ok(
    validateDraft(lightning, { ...base, red_radius_m: "0" }, []).some((p) => /between 1 and 100000/.test(p)),
  );
  assert.deepEqual(validateDraft(lightning, { ...base, red_radius_m: "8000" }, []), []);
});

test("neither haze nor lightning needs a table or a companion row", () => {
  // Readings are shared per region (haze) or island-wide (lightning), so unlike
  // wbgt there is no per-project DDL and nothing to create alongside the row.
  for (const definition of [haze, lightning]) {
    assert.equal(definition.rpc, undefined, definition.service);
    assert.equal(definition.companion, undefined, definition.service);
  }
});

test("both warn that enabling is what trips the delivery CHECK", () => {
  // The row is created disabled, so haze_enabled_delivery_check and its
  // lightning twin do not fire on insert — they bite later.
  for (const definition of [haze, lightning]) {
    assert.equal(buildInsertRow(definition, { project_code: "ZRA" }, {}).enabled, false);
  }
  assert.ok(haze.outsideHalo.some((s) => /haze_enabled_delivery_check/.test(s)));
});

// ---------------------------------------------------------------------------
// noise, subcon and issue chaser.
// ---------------------------------------------------------------------------

const noise = onboardingFor("noise")!;
const subcon = onboardingFor("subcon")!;
const issueChaser = onboardingFor("issueChaser")!;

test("noise creates its readings table before the row, like wbgt", () => {
  assert.equal(noise.rpc?.fn, "ensure_project_readings_table");
  assert.deepEqual(noise.rpc?.args("ZRA"), { p_project_code: "ZRA" });
  assert.equal(noiseTableForProject("CR 106"), "cr_106_noise_data_daily");
  assert.equal(noise.rpc?.expects("CR 106"), "cr_106_noise_data_daily");
  // Same normalisation rule, different suffix — the two must not be conflated.
  assert.notEqual(noiseTableForProject("ZRA"), wbgtTableForProject("ZRA"));
});

test("noise onboarding does not pretend to set up limits", () => {
  // noise_limits is one row per meter per hour band per day type. Nothing is
  // measured against anything until they exist, and inventing them would be
  // worse than saying so.
  assert.equal(noise.companion, undefined, "limits are not a companion row");
  assert.ok(
    noise.outsideHalo.some((step) => /noise_limits/.test(step)),
    "the limits step must be stated explicitly",
  );
  assert.equal(
    noise.fields.some((f) => /limit/i.test(f.column)),
    false,
    "no limit field belongs in this dialog",
  );
});

test("subcon onboarding matches the two-route service, and the house field order", () => {
  // The delivery URL goes last, as it does for every other flow: prefilled from
  // env and rarely touched, so it should not interrupt what someone types.
  const columns = subcon.fields.map((f) => f.column);
  assert.deepEqual(columns, [
    "project_code",
    "company",
    "spreadsheet_id",
    "safety_group_ids",
    "manpower_activity_outbound_group_id",
    "instance_name",
    "client_id",
    "lambda_url",
  ]);
  assert.equal(subcon.fields.at(-1)?.envDefault, "DEFAULT_LAMBDA_URL_SEND", "and it is prefilled");
  assert.equal(subcon.rpc, undefined, "no DDL");
  assert.equal(subcon.companion, undefined);

  // Only what the database actually demands is required. Every switch and every
  // delivery field can be filled in later from the editor.
  const required = subcon.fields.filter((f) => f.required).map((f) => f.column);
  assert.deepEqual(required, ["project_code", "spreadsheet_id"], "the two NOT NULL columns with no default");
});

test("every onboarding flow requires only what the table demands", () => {
  // A field marked required that the database would happily accept as null is a
  // dialog inventing a rule, and it blocks a legitimate draft row.
  for (const key of SERVICE_KEYS) {
    const definition = onboardingFor(key)!;
    for (const field of definition.fields.filter((f) => f.required)) {
      const ok = field.column === "project_code" || field.notNull || field.envDefault || field.fallback;
      assert.ok(ok, `${key}.${field.column} is required but nothing forces it`);
    }
  }
});

test("issue chaser cannot be created with a style already on", () => {
  // A CHECK refuses any style unless `enabled` is true, and rows are created
  // disabled — so a style must not be offered at creation time at all.
  const columns = issueChaser.fields.map((f) => f.column);
  for (const style of [
    "severity_cadence_chaser_enabled",
    "same_day_open_snapshot_enabled",
    "priority_one_escalation_enabled",
  ]) {
    assert.equal(columns.includes(style), false, `${style} must not be settable at creation`);
  }
  assert.equal(buildInsertRow(issueChaser, { project_code: "ZRA" }, {}).enabled, false);
});

test("issue chaser and the two SG services share the uppercase code rule", () => {
  for (const definition of [issueChaser, onboardingFor("haze")!, onboardingFor("lightning")!]) {
    assert.equal(definition.codePattern.test("ZRA"), true, definition.service);
    assert.equal(definition.codePattern.test("zra"), false, `${definition.service} lowercase`);
  }
  // noise and subcon have no CHECK, so lowercase is accepted there.
  assert.equal(noise.codePattern.test("zra"), true);
  assert.equal(subcon.codePattern.test("zra"), true);
  // But noise still needs a leading letter, for the table name.
  assert.equal(noise.codePattern.test("106"), false);
});

test("every onboarding flow names steps HALO cannot perform", () => {
  for (const key of SERVICE_KEYS) {
    const definition = onboardingFor(key)!;
    assert.ok(definition.outsideHalo.length >= 2, `${key} should name its manual steps`);
    for (const step of definition.outsideHalo) {
      assert.ok(step.length > 40, `${key} step should be actionable: ${step}`);
    }
  }
});

test("every onboarding flow picks WhatsApp groups, never types them", () => {
  // A chat id says nothing on its own, and choosing the wrong group is the kind
  // of mistake nobody notices until a site receives another site's messages. The
  // editor has always used the picker; onboarding was still a plain text box.
  const groupColumns = new Set(CHAT_ID_COLUMNS);
  for (const key of SERVICE_KEYS) {
    const definition = onboardingFor(key)!;
    const groupFields = definition.fields.filter((f) => groupColumns.has(f.column));
    assert.ok(groupFields.length >= 1, `${key} should collect at least one group column`);
    for (const field of groupFields) {
      assert.equal(field.kind, "groups", `${key}.${field.column} must use the picker`);
    }
  }
});

test("no onboarding field claims a group column under another kind", () => {
  // The reverse direction: a column the alias store resolves must not be
  // rendered as free text, or the names never appear.
  const mistyped: string[] = [];
  for (const key of SERVICE_KEYS) {
    for (const field of onboardingFor(key)!.fields) {
      if (CHAT_ID_COLUMNS.includes(field.column) && field.kind !== "groups") {
        mistyped.push(`${key}.${field.column} is ${field.kind}`);
      }
    }
  }
  assert.deepEqual(mistyped, []);
});

test("noise and wbgt can be given their sheet id at creation", () => {
  // Both services' sheet actions are gated on these columns, so a project
  // created without one cannot be worked on from the action row at all — the
  // reason they belong in the create dialog and not only in the editor.
  const gated: [ServiceKey, string, string][] = [
    ["noise", "google_sheet_id", "Analysis sheet ID"],
    ["wbgt", "monthly_sheet_id", "Monthly sheet ID"],
  ];

  for (const [service, column, label] of gated) {
    const field = onboardingFor(service)!.fields.find((entry) => entry.column === column);
    assert.ok(field, `${service} onboarding must offer ${column}`);
    assert.equal(field!.kind, "sheet", "and as a sheet field, so a pasted URL is unpacked");
    assert.equal(field!.label, label, "labelled as the editor labels it");
    // Nullable columns: the house rule is that the dialog requires only what the
    // table demands, and a project is often drafted before its sheet exists.
    assert.equal(field!.required, false);
    // The job registry must be gating on the same column, or this field is
    // offering to fill something no action reads.
    const jobs = jobsForService(service);
    assert.ok(
      jobs.some((job) => job.precondition.label === label),
      `${service} has no job gated on ${label} — check the column still matches lib/jobs.ts`,
    );
  }
});

test("a pasted sheet URL becomes the bare id, and nonsense is refused", () => {
  const definition = onboardingFor("wbgt")!;
  const id = "1l9EbI6hcwHSjSaO6_Z4Z8ODrbVzqy5Bb-_9nqpDjmgk";
  const field = definition.fields.find((entry) => entry.column === "monthly_sheet_id")!;

  // Pasting the address bar is the natural gesture; the services want the id.
  assert.equal(
    resolveValue(field, { monthly_sheet_id: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0` }, "TJR", {}),
    id,
  );
  assert.equal(resolveValue(field, { monthly_sheet_id: ` ${id} ` }, "TJR", {}), id);

  // And the row that gets written carries the id, not the URL.
  const row = buildInsertRow(definition, {
    project_code: "TJR",
    monthly_sheet_id: `https://docs.google.com/spreadsheets/d/${id}/edit`,
  });
  assert.equal(row.monthly_sheet_id, id);

  // A value Postgres would store and Google would reject fails here instead.
  const problems = validateDraft(definition, { project_code: "TJR", monthly_sheet_id: "the monthly one" }, []);
  assert.ok(
    problems.some((problem) => /does not look like a Google Sheet id/.test(problem)),
    `expected a sheet-id complaint, got ${JSON.stringify(problems)}`,
  );

  // Blank stays legal: the column is nullable and a draft row is the point.
  assert.deepEqual(validateDraft(definition, { project_code: "TJR" }, []), []);
});

test("a new Lightning project starts ground-only on both tiers", () => {
  const definition = onboardingFor("lightning")!;
  const field = (column: string) => definition.fields.find((entry) => entry.column === column);

  // Ground-only for both, so widening to intra-cloud is a decision someone makes
  // rather than one they inherit. Note the amber column's own Postgres default is
  // {C,G} — this deliberately differs from it.
  assert.equal(field("red_detection_types")?.fallback, "G");
  assert.equal(field("amber_detection_types")?.fallback, "G");
  assert.equal(field("feed_stale_after_seconds")?.fallback, "600");

  // Prefilled, so the values are visible before anyone approves the row.
  const prefill = prefillDefaults(definition, {});
  assert.equal(prefill.red_detection_types, "G");
  assert.equal(prefill.amber_detection_types, "G");
  assert.equal(prefill.feed_stale_after_seconds, "600");

  // text[] columns must reach PostgREST as arrays. A bare "G" is rejected.
  const row = buildInsertRow(definition, {
    project_code: "ZZT",
    latitude: "1.3",
    longitude: "103.8",
    red_radius_m: "8000",
    amber_radius_m: "12000",
  });
  assert.deepEqual(row.red_detection_types, ["G"]);
  assert.deepEqual(row.amber_detection_types, ["G"]);
  assert.equal(row.feed_stale_after_seconds, "600");

  // A typed list becomes an array.
  assert.deepEqual(
    buildInsertRow(definition, { project_code: "ZZT", red_detection_types: "G, C" }).red_detection_types,
    ["G", "C"],
  );
  // Clearing the box falls back to G rather than writing an empty array, which
  // the column's `cardinality(...) > 0` CHECK would refuse. The empty-array path
  // in buildInsertRow is only reachable for a multi field with no fallback, and
  // there is deliberately no such field.
  assert.deepEqual(
    buildInsertRow(definition, { project_code: "ZZT", red_detection_types: "" }).red_detection_types,
    ["G"],
  );
  assert.deepEqual(
    definition.fields.filter((entry) => entry.kind === "multi" && !entry.fallback),
    [],
    "a multi field with no fallback would insert [] and hit the cardinality CHECK",
  );

  // And a value the column's `<@ array['G','C']` CHECK would reject is caught here.
  const problems = validateDraft(
    definition,
    {
      project_code: "ZZT",
      latitude: "1.3",
      longitude: "103.8",
      red_radius_m: "8000",
      amber_radius_m: "12000",
      red_detection_types: "G, X",
    },
    [],
  );
  assert.ok(
    problems.some((problem) => /allowed values are G, C/.test(problem)),
    `expected a strike-type complaint, got ${JSON.stringify(problems)}`,
  );
});

test("haze and lightning can be configured at creation; noise and wbgt stay minimal", () => {
  // Deliberately only these two. Noise carries eight cadences with their own
  // formats and windows, and WBGT nearly as many — offering all of that at
  // creation would be a worse dialog than the editor, and the user asked for
  // these two only.
  // `company` is a select in every service — identity, not cadence — so it is
  // excluded here and asserted separately below.
  const cadenceish = (key: ServiceKey) =>
    onboardingFor(key)!
      .fields.filter(
        (f) => f.column !== "company" && (f.kind === "toggle" || f.kind === "select" || f.kind === "hhmm"),
      )
      .map((f) => f.column);

  assert.deepEqual(cadenceish("haze"), [
    "four_hourly",
    "alert_only_when_at_least",
    "advisory_format",
    "working_hours_start_hhmm",
    "working_hours_end_hhmm",
    "remove_sunday_notifications",
    "remove_ph_notifications",
  ]);
  assert.deepEqual(cadenceish("lightning"), [
    "amber_enabled",
    "working_hours_start_hhmm",
    "working_hours_end_hhmm",
    "remove_sunday_notifications",
    "remove_ph_notifications",
  ]);
  assert.deepEqual(cadenceish("noise"), []);
  assert.deepEqual(cadenceish("wbgt"), []);
});

test("every onboarding flow offers the company, and lightning hides what it still writes", () => {
  for (const key of SERVICE_KEYS) {
    const field = onboardingFor(key)!.fields.find((f) => f.column === "company");
    assert.ok(field, `${key} must offer company`);
    assert.equal(field!.kind, "select");
    assert.equal(field!.required, false, "identity, and a new operating company arrives before the list does");
    assert.deepEqual(field!.options, ["", "Wohhup", "Obayashi", "PentaOcean"]);
    // A blank stays null rather than "", since nothing reads the column and an
    // empty string would look like a company named "".
    assert.equal(buildInsertRow(onboardingFor(key)!, { project_code: "ZZT" }).company, null);
  }

  // Two lightning fields are written but not asked about. site_extent is 0 for
  // almost every site; the staleness window has one sensible answer. Both are
  // hidden rather than dropped, because the live column default for
  // feed_stale_after_seconds is 360 while setup.sql says 600 — omitting the
  // field would quietly onboard a six-minute window nobody chose.
  const lightning = onboardingFor("lightning")!;
  const hidden = lightning.fields.filter((f) => f.hidden).map((f) => f.column);
  assert.deepEqual(hidden, ["site_extent_radius_m", "feed_stale_after_seconds"]);
  const row = buildInsertRow(lightning, { project_code: "ZZT" });
  assert.equal(row.site_extent_radius_m, "0");
  assert.equal(row.feed_stale_after_seconds, "600", "not the column's 360");
});

test("the new field kinds reach Postgres in the shape the column wants", () => {
  const haze = onboardingFor("haze")!;
  const row = buildInsertRow(haze, {
    project_code: "ZZT",
    latitude: "1.3",
    longitude: "103.8",
    nea_region: "north",
    four_hourly: "true",
  });

  // Booleans, not the strings "true"/"false" — "false" is truthy in enough
  // places that sending it would eventually bite.
  assert.equal(row.four_hourly, true);
  assert.equal(typeof row.four_hourly, "boolean");
  assert.equal(buildInsertRow(haze, { project_code: "ZZT" }).four_hourly, false, "the fallback is off");
  assert.equal(buildInsertRow(haze, { project_code: "ZZT" }).remove_sunday_notifications, false);

  // A NOT NULL enum keeps its fallback; a nullable select left alone is null.
  assert.equal(row.advisory_format, "default");
  assert.equal(row.alert_only_when_at_least, null);

  // Amber defaults ON for lightning, which is the opposite of every other
  // toggle here — off means amber is not evaluated at all.
  assert.equal(buildInsertRow(onboardingFor("lightning")!, { project_code: "ZZT" }).amber_enabled, true);
});

test("a half-open working-hours window is refused, not silently ignored", () => {
  // The database keeps them both-or-neither and the services treat one end alone
  // as no window, so a dialog that accepted it would imply a restriction nothing
  // enforces.
  for (const key of ["haze", "lightning"] as ServiceKey[]) {
    const definition = onboardingFor(key)!;
    const base: Record<string, string> = {
      project_code: "ZZT",
      latitude: "1.3",
      longitude: "103.8",
      nea_region: "north",
      red_radius_m: "8000",
      amber_radius_m: "12000",
    };
    const half = validateDraft(definition, { ...base, working_hours_start_hhmm: "0800" }, []);
    assert.ok(half.some((p) => /both ends, or neither/.test(p)), `${key}: ${JSON.stringify(half)}`);

    const same = validateDraft(
      definition,
      { ...base, working_hours_start_hhmm: "0800", working_hours_end_hhmm: "0800" },
      [],
    );
    assert.ok(same.some((p) => /same time/.test(p)), `${key}: ${JSON.stringify(same)}`);

    // A real window passes, including one that wraps midnight.
    assert.deepEqual(
      validateDraft(definition, { ...base, working_hours_start_hhmm: "1900", working_hours_end_hhmm: "0700" }, []),
      [],
    );
    // And a malformed time is caught before Postgres sees it.
    assert.ok(
      validateDraft(definition, { ...base, working_hours_start_hhmm: "8am", working_hours_end_hhmm: "1900" }, [])
        .some((p) => /24-hour HHMM/.test(p)),
    );
  }
});

test("a select refuses a value its column would refuse", () => {
  const problems = validateDraft(
    onboardingFor("haze")!,
    { project_code: "ZZT", latitude: "1.3", longitude: "103.8", nea_region: "north", advisory_format: "wohup" },
    [],
  );
  assert.ok(
    problems.some((p) => /is not one of default, wohhup/.test(p)),
    `expected an advisory-format complaint, got ${JSON.stringify(problems)}`,
  );
});
