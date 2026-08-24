import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInsertRow,
  missingEnvDefaults,
  onboardingFor,
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

test("only ailytics offers onboarding today", () => {
  assert.ok(onboardingFor("ailytics"));
  for (const service of ["wbgt", "noise", "haze", "lightning", "subcon"] as const) {
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
  // A typed value always wins over the derived one.
  const overridden = buildInsertRow(ailytics, { ...complete, activity_history_tab: "Custom tab" }, {});
  assert.equal(overridden.activity_history_tab, "Custom tab");
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
