import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  CANONICAL_ENV_DEFAULTS,
  ENV_DEFAULTS,
  ENV_DEFAULT_NAMES,
  envDefaultName,
  isBlankValue,
  resolveCanonicalEnvDefaults,
  resolveEnvDefault,
} from "../lib/env-defaults";
import { buildFieldSpec } from "../lib/field-spec";
import { canonicalDeliveryDefaults } from "../lib/canonical-projects";
import { onboardingFor } from "../lib/onboarding";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { SERVICE_KEYS } from "../lib/services";

const source = (path: string) => readFile(resolve(path), "utf8");

const ENV = {
  DEFAULT_LAMBDA_URL_SEND: "https://gw.example/proxy/send-message",
  DEFAULT_LAMBDA_URL_REPLY: "https://gw.example/proxy/reply-message",
  DEFAULT_LAMBDA_URL_IMAGE: "https://gw.example/proxy/send-document",
};

const text = { type: "string" as const, format: "text", enum: null, default: null };

/**
 * The registry names columns that live in other repositories, so it is checked
 * against the pinned contract rather than trusted — a column renamed upstream
 * must fail the build here rather than silently stop offering its default.
 */
test("every column given an env default is a column its service actually has", () => {
  let checked = 0;
  for (const service of SERVICE_KEYS) {
    const fields = new Set(Object.keys(SERVICE_CONTRACTS[service]!.configuration.fields));
    for (const column of Object.keys(ENV_DEFAULTS[service])) {
      assert.ok(fields.has(column), `${service}.${column} has an env default but is not in the contract`);
      checked += 1;
    }
  }
  assert.equal(
    checked,
    10,
    "seven send URLs, ailytics' reply and image, and WBGT's document URL for the monthly report",
  );
});

test("the deployment can actually supply every variable named", async () => {
  // A default declared here but absent from amplify.yml's capture list is a
  // default that works locally and silently does nothing once deployed.
  const amplify = await source("amplify.yml");
  for (const name of ENV_DEFAULT_NAMES) {
    assert.ok(amplify.includes(name), `amplify.yml must carry ${name}`);
  }
  assert.deepEqual(ENV_DEFAULT_NAMES, [
    "DEFAULT_LAMBDA_URL_IMAGE",
    "DEFAULT_LAMBDA_URL_REPLY",
    "DEFAULT_LAMBDA_URL_SEND",
  ]);
});

/**
 * The drift guard that matters most.
 *
 * Three places now decide which variable fills which column: this registry, the
 * create dialog's per-field `envDefault`, and the canonical registry's
 * `canonicalDeliveryDefaults`. They were written at different times and they
 * agree today. Nothing but this test would notice them disagreeing, and the
 * symptom would be a create dialog and an editor offering different URLs for
 * the same column.
 */
test("the create dialog and the registry name the same variable for the same column", () => {
  for (const service of SERVICE_KEYS) {
    const definition = onboardingFor(service);
    if (!definition) continue;
    for (const field of definition.fields) {
      const registry = envDefaultName(service, field.column);
      if (field.envDefault || registry) {
        assert.equal(
          field.envDefault ?? null,
          registry,
          `${service}.${field.column}: dialog says ${field.envDefault}, registry says ${registry}`,
        );
      }
    }
  }
});

test("the canonical registry's three resolve from the same variables", () => {
  const legacy = canonicalDeliveryDefaults(ENV);
  const resolved = resolveCanonicalEnvDefaults(ENV);
  for (const [column, name] of Object.entries(CANONICAL_ENV_DEFAULTS)) {
    assert.equal(resolved[column]?.name, name);
    assert.equal(resolved[column]?.value, ENV[name as keyof typeof ENV]);
    // The pre-existing helper and the new one must not drift apart: the create
    // path uses the first, the editor's offer uses the second.
    assert.equal(resolved[column]?.value, legacy[column as keyof typeof legacy]);
  }
});

/**
 * The deliberate absence, asserted so it survives someone "finishing the job".
 *
 * `instance_name` and `client_id` sit beside `lambda_url`, are just as
 * unmemorable, and carry six distinct values across the estate because they
 * name which WhatsApp instance a company is on. Defaulting them would route one
 * company's messages through another's instance.
 */
test("the per-project plumbing columns are left alone", () => {
  for (const service of SERVICE_KEYS) {
    for (const column of ["instance_name", "client_id", "enabled", "project_code", "company"]) {
      assert.equal(
        envDefaultName(service, column),
        null,
        `${service}.${column} must not be defaulted from the environment`,
      );
    }
  }
});

test("a field spec carries the default, resolved, or null when it cannot", () => {
  const withEnv = buildFieldSpec("noise", { lambda_url: text, instance_name: text }, ENV);
  assert.deepEqual(withEnv.fields.lambda_url?.envDefault, {
    name: "DEFAULT_LAMBDA_URL_SEND",
    value: ENV.DEFAULT_LAMBDA_URL_SEND,
  });
  // A real per-project column carries nothing, and so does every consumer.
  assert.equal(withEnv.fields.instance_name?.envDefault, null);

  // An unset variable offers nothing rather than offering "". A partly
  // configured deployment degrades to the blank box it had before.
  const unset = buildFieldSpec("noise", { lambda_url: text }, {});
  assert.equal(unset.fields.lambda_url?.envDefault, null);

  // Omitting env entirely is the same as having none — this is what every test
  // and every caller that does not care gets.
  assert.equal(buildFieldSpec("noise", { lambda_url: text }).fields.lambda_url?.envDefault, null);
});

test("ailytics is the one service offered all three", () => {
  const spec = buildFieldSpec(
    "ailytics",
    { lambda_url: text, reply_lambda_url: text, lambda_url_image: text },
    ENV,
  );
  assert.equal(spec.fields.lambda_url?.envDefault?.name, "DEFAULT_LAMBDA_URL_SEND");
  assert.equal(spec.fields.reply_lambda_url?.envDefault?.name, "DEFAULT_LAMBDA_URL_REPLY");
  assert.equal(spec.fields.lambda_url_image?.envDefault?.name, "DEFAULT_LAMBDA_URL_IMAGE");

  // And no other service pretends to have them, because no other service has
  // the columns.
  for (const service of SERVICE_KEYS) {
    if (service === "ailytics") continue;
    assert.equal(resolveEnvDefault(service, "reply_lambda_url", ENV), null, `${service} has no reply column`);
    assert.equal(resolveEnvDefault(service, "lambda_url_image", ENV), null, `${service} has no image column`);
  }
});

test("a placeholder value counts as blank, a real URL does not", () => {
  // One live noise row carries the literal "-" in lambda_url, which fails
  // row-rules' https:// check exactly as an empty string does. Treating it as
  // set would leave the one row that most needs the offer without it.
  for (const blank of ["", "   ", "-", "—", "n/a", "N/A", "none", "NULL", null, undefined]) {
    assert.equal(isBlankValue(blank), true, `${JSON.stringify(blank)} should read as blank`);
  }
  for (const set of ["https://gw.example/proxy/send-message", "http://x", "0"]) {
    assert.equal(isBlankValue(set), false, `${set} should read as set`);
  }
});

/**
 * The property the whole design rests on: the default is OFFERED, never taken.
 *
 * A prefill written into the draft would show the field as filled AND save it
 * on the next unrelated edit. The chosen behaviour is the opposite — nothing
 * reaches the database until someone presses the button — so the editor's
 * initial draft must stay exactly what a chat proposal put there.
 */
test("the editor offers the default without adopting it", async () => {
  const editor = await source("components/ConfigEditor.tsx");

  // The draft still starts from the proposal alone. Seeding it from envDefault
  // here is precisely the silent write this design rejects.
  assert.match(editor, /useState<Draft>\(initialDraft \?\? \{\}\)/);
  // The value reaches the input as a placeholder, which no browser submits.
  assert.match(editor, /placeholder=\{[\s\S]{0,200}field\.envDefault\?\.value/);

  const hint = await source("components/EnvDefaultHint.tsx");
  // It renders nothing once the column has a value, so a filled field never
  // carries a standing note about a different URL.
  assert.match(hint, /if \(!envDefault \|\| !isBlankValue\(value\)\) return null;/);
  // Adopting is a deliberate press, and it goes through the ordinary draft path
  // so the change appears in the diff and the audit row like any other.
  assert.match(hint, /onClick=\{\(\) => onUse\(envDefault\.value\)\}/);
});

test("the canonical editor offers the same three the same way", async () => {
  const editor = await source("components/CanonicalProjectEditor.tsx");
  for (const column of Object.keys(CANONICAL_ENV_DEFAULTS)) {
    assert.ok(editor.includes(column), `${column} must still be an offered field`);
  }
  assert.match(editor, /placeholder=\{deliveryDefaults\[column\]\?\.value\}/);
  assert.match(editor, /<EnvDefaultHint/);
  // Resolved on the server and passed down: reading process.env in this client
  // component would read a different object and quietly offer nothing.
  assert.doesNotMatch(editor, /process\.env/);

  for (const page of ["app/projects/[id]/page.tsx", "app/projects/new/page.tsx"]) {
    assert.match(await source(page), /resolveCanonicalEnvDefaults\(process\.env\)/, `${page} must resolve them`);
  }
});

/**
 * The monthly WBGT report's three columns.
 *
 * Live in Supabase since the service's `migrate_monthly_wbgt_report.sql` was
 * applied, so HALO introspects them whether or not it has anything to say about
 * them — and before this it had nothing, so all three rendered raw under
 * "Other" with the column name as the label and no help at all.
 *
 * Deliberately NOT asserted against the pinned contract here: the service's
 * contract change is not committed yet, so the route and the `lambda_url_document`
 * env default cannot be wired until it is. See the note in AGENTS.md.
 */
test("the monthly WBGT report columns are labelled, grouped and explained", () => {
  const text = { type: "string" as const, format: "text", enum: null, default: null };
  const bool = { type: "boolean" as const, format: "boolean", enum: null, default: false };
  const spec = buildFieldSpec("wbgt", {
    lambda_url: text,
    lambda_url_document: text,
    enable_monthly_wbgt_report: bool,
    monthly_wbgt_report_whatsapp_group_ids: text,
  }, {});

  for (const column of ["lambda_url_document", "enable_monthly_wbgt_report", "monthly_wbgt_report_whatsapp_group_ids"]) {
    const field = spec.fields[column];
    assert.ok(field, `${column} must be described`);
    assert.notEqual(field.label, column, `${column} still renders its own column name as its label`);
    assert.ok(field.help.length > 40, `${column} needs help text, not a restated label`);
    assert.ok(
      spec.groups.some((group) => group.title !== "Other" && group.fields.includes(column)),
      `${column} is still falling into Other`,
    );
  }

  // The recipient list is a group picker, like every other chat-id column —
  // typing a raw `@g.us` id by hand is how the wrong group gets a workbook.
  assert.equal(spec.fields.monthly_wbgt_report_whatsapp_group_ids?.widget, "groups");
  assert.equal(spec.fields.enable_monthly_wbgt_report?.widget, "toggle");

  // The report is its own section: the monthly SHEET is written all month by
  // the fill job, while this is one delivery to its own audience.
  const section = spec.groups.find((group) => group.title === "Monthly report");
  assert.ok(section, "the report needs its own section");
  assert.deepEqual(section?.fields, ["enable_monthly_wbgt_report", "monthly_wbgt_report_whatsapp_group_ids"]);

  // The document URL belongs with the other delivery plumbing, where the send
  // URL it is derived from already sits.
  const delivery = spec.groups.find((group) => group.title === "Delivery");
  assert.ok(delivery, "the Delivery section must still exist");
  assert.ok(delivery.fields.includes("lambda_url_document"));
  assert.ok(delivery.fields.indexOf("lambda_url") < delivery.fields.indexOf("lambda_url_document"));
});

test("the document URL's help states the one case where it is mandatory", () => {
  const text = { type: "string" as const, format: "text", enum: null, default: null };
  const help = buildFieldSpec("wbgt", { lambda_url_document: text }, {}).fields.lambda_url_document?.help ?? "";
  // `documentEndpoint` throws when this is blank AND lambda_url does not end in
  // /send-message. Calling the column merely "optional" would be wrong in
  // exactly the case that breaks the report.
  assert.match(help, /send-message/);
  assert.match(help, /required|needed/i);
});
