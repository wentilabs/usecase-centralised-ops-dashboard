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
import type { FieldSpec } from "../lib/field-spec";
import { firesAt, hasCadence } from "../lib/card-summary";

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
