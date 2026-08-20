import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canAccessDashboard,
  canEditConfigs,
  getSafeRedirect,
  isEmailWhitelisted,
  shouldBypassLocalAuth,
} from "../lib/auth-policy";
import { isApiPath, isPublicPath, isWriteRequest } from "../lib/route-policy";
import { coerceValue, effectiveChanges, validateChanges } from "../lib/config-values";
import { buildFieldSpec, type FieldSpec } from "../lib/field-spec";
import { SERVICE_KEYS, SERVICES } from "../lib/services";
import {
  autoLinks,
  CHAT_ID_COLUMNS,
  chatIdsIn,
  deliveryGroups,
  firesAt,
  hasCadence,
  pillsFor,
} from "../lib/card-summary";

const field = (over: Partial<FieldSpec>): FieldSpec => ({
  name: "f",
  label: "F",
  help: "",
  widget: "text",
  options: null,
  default: null,
  readonly: false,
  hidden: false,
  showIf: null,
  row: null,
  ...over,
});

test("email allow-list matches exact addresses and whole domains", () => {
  assert.equal(isEmailWhitelisted("me@wentilabs.com", "", "wentilabs.com"), true);
  assert.equal(isEmailWhitelisted("ME@WentiLabs.com ", "", "wentilabs.com"), true);
  assert.equal(isEmailWhitelisted("me@other.com", "me@other.com", ""), true);
  assert.equal(isEmailWhitelisted("me@other.com", "", "wentilabs.com"), false);
  assert.equal(isEmailWhitelisted("me@sub.wentilabs.com", "", "wentilabs.com"), false);
  assert.equal(isEmailWhitelisted("me@wentilabs.com", "", ""), false);
  assert.equal(isEmailWhitelisted("not-an-email", "", "wentilabs.com"), false);
});

test("an editor list makes everyone else read-only", () => {
  assert.equal(canEditConfigs("me@w.com", ""), true, "empty list = everyone may edit");
  assert.equal(canEditConfigs("me@w.com", "me@w.com, boss@w.com"), true);
  assert.equal(canEditConfigs("intern@w.com", "me@w.com"), false);
  assert.equal(canEditConfigs(null, "me@w.com"), false);
});

test("local bypass is loopback-only, never in production, killable", () => {
  assert.equal(shouldBypassLocalAuth({ nodeEnv: "development", hostname: "localhost" }), true);
  assert.equal(shouldBypassLocalAuth({ nodeEnv: "production", hostname: "localhost" }), false);
  assert.equal(shouldBypassLocalAuth({ nodeEnv: "development", hostname: "ops.company.com" }), false);
  assert.equal(
    shouldBypassLocalAuth({ nodeEnv: "development", hostname: "localhost", requestHost: "ops.company.com" }),
    false,
  );
  assert.equal(shouldBypassLocalAuth({ nodeEnv: "development", hostname: "localhost", bypassDisabled: true }), false);
  assert.equal(
    shouldBypassLocalAuth({ nodeEnv: "development", hostname: "localhost", bypassSetting: "false" }),
    false,
  );
});

test("the gate fails closed when auth is unconfigured or erroring", () => {
  const base = { isLocalBypass: false, configured: true, authError: false, domainList: "w.com" };
  assert.equal(canAccessDashboard({ ...base, email: "me@w.com" }), true);
  assert.equal(canAccessDashboard({ ...base, email: "me@elsewhere.com" }), false);
  assert.equal(canAccessDashboard({ ...base, configured: false, email: "me@w.com" }), false);
  assert.equal(canAccessDashboard({ ...base, authError: true, email: "me@w.com" }), false);
  assert.equal(canAccessDashboard({ isLocalBypass: true, configured: false, email: null }), true);
});

test("only same-origin paths survive as redirects", () => {
  assert.equal(getSafeRedirect("/?tab=noise"), "/?tab=noise");
  assert.equal(getSafeRedirect("//evil.com"), "/");
  assert.equal(getSafeRedirect("https://evil.com/x"), "/");
  assert.equal(getSafeRedirect("/a\\b"), "/");
  assert.equal(getSafeRedirect(null), "/");
});

test("route policy separates public, api and write requests", () => {
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/"), false);
  assert.equal(isApiPath("/api/projects"), true);
  assert.equal(isWriteRequest("patch"), true);
  assert.equal(isWriteRequest("GET"), false);
});

test("values are coerced and rejected against the schema", () => {
  assert.equal(coerceValue(field({ type: "boolean", widget: "toggle" }), true), true);
  assert.throws(() => coerceValue(field({ type: "boolean", widget: "toggle" }), "yes"));
  assert.equal(coerceValue(field({ type: "integer", widget: "number" }), "8"), 8);
  assert.throws(() => coerceValue(field({ type: "integer", widget: "number" }), "8.5"));
  assert.equal(coerceValue(field({ widget: "hhmm" }), "0730"), "0730");
  assert.throws(() => coerceValue(field({ widget: "hhmm" }), "7am"));
  assert.deepEqual(coerceValue(field({ type: "array", widget: "multi", options: ["G", "C"] }), ["G"]), ["G"]);
  assert.throws(() => coerceValue(field({ type: "array", widget: "multi", options: ["G", "C"] }), ["X"]));
  assert.equal(coerceValue(field({}), ""), null, "blank clears the column");
});

test("unknown and read-only columns are refused", () => {
  const fields = { a: field({ name: "a" }), locked: field({ name: "locked", readonly: true }) };
  const { patch, rejected } = validateChanges(fields, { a: "x", locked: "y", nope: "z" });
  assert.deepEqual(patch, { a: "x" });
  assert.equal(rejected.length, 2);
  assert.ok(rejected.some((r) => r.includes("read-only")));
  assert.ok(rejected.some((r) => r.includes("unknown column")));
});

test("no-op changes are dropped before writing", () => {
  assert.deepEqual(effectiveChanges({ a: 1, b: 2 }, { a: 1, b: 3 }), { b: 3 });
  assert.deepEqual(effectiveChanges({ a: null }, { a: null }), {});
});

test("fires-at reflects the wbgt intermittent formatter", () => {
  const base = { enable_hourly: true, site_hours_start: 9, site_hours_end: 18 };
  assert.match(firesAt("wbgt", { ...base, enable_intermittent_reports: true }), /:15\/:45 if High/);
  assert.match(
    firesAt("wbgt", { ...base, enable_intermittent_reports: true, intermittent_reports_formatter: "red30" }),
    /:30 if High/,
  );
  assert.equal(firesAt("wbgt", { enable_hourly: false }), "No cadences enabled");
});

test("cadence detection sinks unscheduled projects", () => {
  assert.equal(hasCadence("wbgt", { enable_hourly: true }), true);
  assert.equal(hasCadence("wbgt", {}), false);
  assert.equal(hasCadence("noise", { enable_three_hour_summary: true }), true);
  assert.equal(hasCadence("haze", { enabled: true }), true);
});

test("haze fires-at reflects the PSI alert gate", () => {
  assert.match(firesAt("haze", { working_hours_start_hhmm: "0800", working_hours_end_hhmm: "1900" }), /08:00–19:00/);
  assert.match(
    firesAt("haze", { alert_only_when_at_least: "unhealthy" }),
    /only when PSI ≥ unhealthy/,
  );
  assert.doesNotMatch(firesAt("haze", {}), /only when PSI/);
});

test("lightning fires-at distinguishes red-only sites", () => {
  assert.match(firesAt("lightning", { amber_enabled: false }), /^red-only/);
  assert.match(firesAt("lightning", { amber_enabled: true }), /^red \+ amber/);
  assert.match(firesAt("lightning", {}), /^red \+ amber/, "default is both");
});

// ---------------------------------------------------------------------------
// Subcon Activities — the one service whose `enabled` flag is not a master
// switch, and the first with several group columns that mean different things.
// ---------------------------------------------------------------------------
test("subcon fires-at names the jobs its toggles enable", () => {
  const all = { enable_manpower: true, enable_housekeeping: true, enable_water_parade: true };
  const line = firesAt("subcon", all);
  assert.match(line, /morning activity \+ manpower summary/);
  assert.match(line, /end-of-day housekeeping report/);
  assert.match(line, /next two :00\/:30/);

  // enable_manpower and enable_housekeeping default true in Postgres, so an
  // empty row is NOT idle — only an explicit false turns them off.
  assert.match(firesAt("subcon", {}), /morning activity/);
  assert.equal(
    firesAt("subcon", { enable_manpower: false, enable_housekeeping: false, enable_water_parade: false }),
    "No usecases enabled",
  );
});

test("subcon says outbound is muted rather than implying nothing runs", () => {
  const muted = firesAt("subcon", { enabled: false, enable_manpower: true });
  assert.match(muted, /outbound muted, still classifying and writing sheets/);
  assert.doesNotMatch(firesAt("subcon", { enabled: true, enable_manpower: true }), /muted/);

  // Cadence drives the grey scrim and the sort; a muted project is still busy.
  assert.equal(hasCadence("subcon", { enabled: false, enable_water_parade: true }), true);
  assert.equal(
    hasCadence("subcon", { enable_manpower: false, enable_housekeeping: false, enable_water_parade: false }),
    false,
  );
});

test("delivery groups keep each service's columns and label subcon's roles", () => {
  assert.deepEqual(deliveryGroups("wbgt", { whatsapp_group_id: "a@g.us, b@g.us" }), [
    { chatId: "a@g.us", role: undefined },
    { chatId: "b@g.us", role: undefined },
  ]);
  assert.deepEqual(deliveryGroups("haze", { wa_group_ids: "h@g.us" }), [{ chatId: "h@g.us", role: undefined }]);
  assert.deepEqual(deliveryGroups("ailytics", { whatsapp_group_ids: "x@g.us" }), [
    { chatId: "x@g.us", role: undefined },
  ]);

  // One chat serving two roles must collapse to a single entry — repeating it
  // would also duplicate the React key on the card.
  assert.deepEqual(
    deliveryGroups("subcon", {
      manpower_activity_outbound_group_id: "same@g.us",
      housekeeping_outbound_group_id: "same@g.us",
      source_group_ids: "in@g.us",
    }),
    [
      { chatId: "same@g.us", role: "manpower + housekeeping" },
      { chatId: "in@g.us", role: "inbound" },
    ],
  );
  assert.deepEqual(deliveryGroups("subcon", {}), []);
});

test("the same spreadsheet_id column is labelled per service", () => {
  const subcon = autoLinks("subcon", { spreadsheet_id: "S1", wbgt_google_sheet_id: "W1" });
  assert.deepEqual(
    subcon.map((l) => l.label),
    ["📗 Manpower sheet", "📗 WBGT sheet (Water Parade)"],
  );
  assert.match(subcon[0].href, /spreadsheets\/d\/S1\/edit$/);

  assert.deepEqual(
    autoLinks("ailytics", { spreadsheet_id: "S1" }).map((l) => l.label),
    ["📗 Safety sheet"],
  );
  // Unchanged for the alert services.
  assert.deepEqual(
    autoLinks("wbgt", { monthly_sheet_id: "M1", latitude: 1.3, longitude: 103.8 }).map((l) => l.label),
    ["📗 Monthly sheet", "📍 Map"],
  );
});

test("the POC switches haze and lightning gained are surfaced as pills", () => {
  const hazePills = pillsFor("haze", { enable_poc_mentions: true, advisory_format: "wohhup" });
  assert.ok(hazePills.some((p) => p.label === "POC mentions" && p.on));
  assert.ok(hazePills.some((p) => p.label === "wohhup format" && p.on));
  // `default` is a real value, not an absence — shown, but not lit up.
  assert.ok(pillsFor("haze", {}).some((p) => p.label === "default format" && !p.on));

  const ltg = pillsFor("lightning", { enable_red_band_poc_mentions: true });
  assert.ok(ltg.some((p) => p.label === "🔴 POC mentions" && p.on));

  const subconPills = pillsFor("subcon", { enabled: false, enable_water_parade: true });
  assert.ok(subconPills.some((p) => p.label === "outbound WhatsApp" && !p.on));
  assert.ok(subconPills.some((p) => p.label === "Water Parade" && p.on));
  assert.ok(subconPills.some((p) => p.label === "manpower & activity" && p.on), "defaults to on");
});

// ---------------------------------------------------------------------------
// Registry: adding a service means touching several maps. A half-wired one
// still renders, so these assertions are the only thing that notices.
// ---------------------------------------------------------------------------
test("every registered service is fully wired", () => {
  const identity = { type: "string" as const, format: "text", enum: null, default: null };
  const columns = {
    project_code: identity,
    created_at: { ...identity, type: "string" as const },
    updated_at: { ...identity, type: "string" as const },
    enabled: { type: "boolean" as const, format: "boolean", enum: null, default: null },
  };

  for (const key of SERVICE_KEYS) {
    const spec = buildFieldSpec(key, { ...columns, ...(SERVICES[key].idColumn === "id" ? { id: identity } : {}) });

    // A missing READONLY entry would silently make the business key writable.
    for (const locked of ["project_code", "created_at", "updated_at"]) {
      assert.equal(spec.fields[locked]?.readonly, true, `${key}.${locked} must be read-only`);
    }
    assert.equal(spec.fields[SERVICES[key].idColumn]?.readonly, true, `${key} identity must be read-only`);

    // Audit stamps and the identity never belong in the editor.
    assert.equal(spec.fields.created_at?.hidden, true, `${key}.created_at must be hidden`);
    assert.equal(spec.fields.updated_at?.hidden, true, `${key}.updated_at must be hidden`);

    // `enabled` is meaningful for every service, so it must be labelled and
    // placed — never swept into "Other".
    assert.notEqual(spec.fields.enabled?.label, "enabled", `${key}.enabled needs a label`);
    const titles = spec.groups.map((g) => g.title);
    assert.ok(titles.length > 0, `${key} has no groups`);
    assert.ok(!titles.includes("Other"), `${key} put a known column in Other: ${JSON.stringify(spec.groups)}`);
  }
});

test("every service resolves its WhatsApp group column", () => {
  // A service missing from GROUP_COLUMNS would silently show "no group
  // configured" on every card.
  const row = {
    whatsapp_group_id: "a@g.us",
    wa_group_ids: "a@g.us",
    whatsapp_group_ids: "a@g.us",
    manpower_activity_outbound_group_id: "a@g.us",
  };
  for (const key of SERVICE_KEYS) {
    assert.ok(deliveryGroups(key, row).length > 0, `${key} resolves no delivery group`);
  }
});

// ---------------------------------------------------------------------------
// Group picker: the "groups" widget is only as good as the alias coverage, so
// every column it is attached to must also be a column we resolve names for.
// ---------------------------------------------------------------------------
test("every group-picker column is one we resolve names for", () => {
  const text = { type: "string" as const, format: "text", enum: null, default: null };
  const introspected = Object.fromEntries(
    [...CHAT_ID_COLUMNS, "telegram_chat_ids", "poc_phone_numbers"].map((c) => [c, text]),
  );

  for (const key of SERVICE_KEYS) {
    const spec = buildFieldSpec(key, introspected);
    for (const [name, field] of Object.entries(spec.fields)) {
      if (field.widget !== "groups") continue;
      assert.ok(
        CHAT_ID_COLUMNS.includes(name),
        `${key}.${name} uses the group picker but is not in CHAT_ID_COLUMNS, so its ids never get a name`,
      );
    }
    // Phone numbers and Telegram chats are not WhatsApp groups.
    assert.notEqual(spec.fields.poc_phone_numbers?.widget, "groups", `${key}.poc_phone_numbers`);
    assert.notEqual(spec.fields.telegram_chat_ids?.widget, "groups", `${key}.telegram_chat_ids`);
  }
});

test("chat ids are collected across every service's columns", () => {
  // Subcon's role-specific columns are included by derivation, not by hand.
  for (const column of [
    "whatsapp_group_id",
    "wa_group_ids",
    "whatsapp_group_ids",
    "manpower_activity_outbound_group_id",
    "housekeeping_outbound_group_id",
    "source_group_ids",
    "alert_whatsapp_gid",
    "poc_alert_wa_groups",
    "whatsapp_wbgt_source_chat_ids",
  ]) {
    assert.ok(CHAT_ID_COLUMNS.includes(column), column);
  }

  assert.deepEqual(chatIdsIn([{ whatsapp_group_id: "a@g.us, b@g.us" }, { wa_group_ids: "b@g.us" }]), [
    "a@g.us",
    "b@g.us",
  ]);
  // Direct chats and phone numbers are not groups and must not be looked up.
  assert.deepEqual(chatIdsIn([{ whatsapp_group_id: "6591234567@c.us, 123@lid, ok@g.us" }]), ["ok@g.us"]);
  assert.deepEqual(chatIdsIn([{}]), []);
});

test("the retired lightning policy_note stays hidden while the column exists", () => {
  // An unlisted column falls through to "Other", so dropping it from the spec
  // is not enough until the DROP COLUMN migration has actually run.
  const spec = buildFieldSpec("lightning", {
    policy_note: { type: "string", format: "text", enum: null, default: null },
    enabled: { type: "boolean", format: "boolean", enum: null, default: null },
  });
  assert.equal(spec.fields.policy_note?.hidden, true);
  assert.ok(!spec.groups.some((g) => g.title === "Other"), "policy_note must not resurface under Other");
});
