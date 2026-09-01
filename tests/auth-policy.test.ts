import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canAccessDashboard,
  canEditConfigs,
  getSafeRedirect,
  isEmailWhitelisted,
  shouldBypassLocalAuth,
} from "../lib/auth-policy";
import { isApiPath, isPublicPath, isWriteRequest } from "../lib/route-policy";
import { coerceValue, effectiveChanges, validateChanges } from "../lib/config-values";
import { COMPANIES, buildFieldSpec, type FieldSpec } from "../lib/field-spec";
import { EXPORT_FORMATS, EXPORTS, JOBS, exportsForService, jobTargets, jobsForService, readSheetId, spanDays, validateJobInput } from "../lib/jobs";
import {
  buildToggles,
  describeSelection,
  includesEveryMeter,
  parseIncludedRecIds,
  serializeSelection,
  toggleMeter,
} from "../lib/meter-selection";
import { SERVICE_KEYS, SERVICES, tagLabel, type ServiceKey } from "../lib/services";
import {
  autoLinks,
  cardEmphasis,
  CHAT_ID_COLUMNS,
  chatIdsIn,
  deliveryGroups,
  emphasisRank,
  matchesQuery,
  searchTokens,
  firesAt,
  groupDelta,
  hasCadence,
  isManualIngestion,
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

test("haze four-hourly reports the cadence it actually runs", () => {
  // `four_hourly` used to mean "ONLY at those four hours", and this test used to
  // assert the floor was not quoted. The service changed (INV-HAZE-01): every
  // project runs hourly, and four-hourly is an override that at 08/12/16/20
  // bypasses both the band floor and the working-hours window. Quoting the
  // floor is now correct, because it governs every other hour of the day.
  const four = firesAt("haze", {
    four_hourly: true,
    working_hours_start_hhmm: "0800",
    working_hours_end_hhmm: "1900",
    alert_only_when_at_least: "unhealthy",
  });
  assert.match(four, /^hourly advisory/, "hourly is the cadence for every project now");
  assert.match(four, /08:00–19:00/, "the window governs the non-override hours");
  assert.match(four, /only when PSI ≥ unhealthy/, "and so does the floor");
  assert.match(four, /08:00, 12:00, 16:00 and 20:00/);
  assert.match(four, /whatever the band/, "the override ignores the floor at those hours");
  assert.match(four, /outside those hours/, "and the working-hours window — 20:00 fires past a 19:00 close");
  assert.match(four, /no daily kickoff/, "four-hourly projects are skipped by the kickoff route");

  const plain = firesAt("haze", {
    working_hours_start_hhmm: "0800",
    working_hours_end_hhmm: "1900",
    alert_only_when_at_least: "unhealthy",
  });
  assert.match(plain, /^hourly advisory/);
  assert.doesNotMatch(plain, /guaranteed send/, "no override without the flag");
});

test("a half-configured haze window is not reported as a range", () => {
  // The service treats one end alone as no window at all; the card used to
  // render `08:00–—` and imply a restriction that was never enforced.
  const line = firesAt("haze", { working_hours_start_hhmm: "0800" });
  assert.match(line, /all day/);
  assert.doesNotMatch(line, /08:00/);
});

test("the haze cadence and band pills say what is in force", () => {
  const four = pillsFor("haze", { four_hourly: true, alert_only_when_at_least: "unhealthy" });
  const plain = pillsFor("haze", { alert_only_when_at_least: "unhealthy" });

  // Every haze project runs hourly, so a cadence pill would be true of all of
  // them and carry no information. It existed only while four-hourly was an
  // alternative cadence rather than an override.
  for (const pills of [four, plain]) {
    assert.ok(!pills.some((p) => /^(hourly|every hour)$/.test(p.label)), "no cadence pill");
  }

  assert.ok(four.some((p) => p.label === "🕓 4-hourly override" && p.on));
  assert.ok(plain.some((p) => p.label === "🕓 4-hourly override" && !p.on), "unlit without the flag");
  // The majority mode, so it must not be emphasised.
  assert.equal(four.find((p) => p.label === "🕓 4-hourly override")?.tone, undefined);

  // The floor is reported as stored either way: with the override on it still
  // governs the other twenty hours, so showing "every band" there would claim
  // the 09:00 send ignores it too.
  assert.ok(four.some((p) => p.label === "≥ unhealthy" && p.on), "the floor still applies off-slot");
  assert.ok(plain.some((p) => p.label === "≥ unhealthy" && p.on));
  assert.ok(!four.some((p) => p.label === "every band"), "which is only true when no floor is stored");
  assert.ok(pillsFor("haze", { four_hourly: true }).some((p) => p.label === "every band"));
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
test("subcon fires-at describes both of its routes", () => {
  // Two independent routes now: /housekeeping-intake accepts forwarded messages
  // and /daily-activity-manpower-summary sends the morning report. Both default
  // on in Postgres, so an empty row is doing both.
  const both = firesAt("subcon", {});
  // Supabase, not a sheet tab: the service stopped writing the Daily Activity
  // projection when Supabase became canonical (9b45234), so naming the tab here
  // would point an operator at a document that no longer updates.
  assert.match(both, /recorded in Supabase/);
  assert.doesNotMatch(both, /Daily Activity/);
  assert.match(both, /morning activity \+ manpower summary/);

  assert.doesNotMatch(firesAt("subcon", { enable_housekeeping: false }), /recorded in Supabase/);
  assert.doesNotMatch(firesAt("subcon", { enabled: false }), /morning summary|manpower summary/);
  assert.match(firesAt("subcon", { enabled: false, enable_housekeeping: false }), /Both routes off/);

  // A report with nowhere to go is the quiet failure worth naming.
  assert.match(firesAt("subcon", { enabled: true }), /no morning report group set/);
  assert.doesNotMatch(
    firesAt("subcon", { enabled: true, manpower_activity_outbound_group_id: "g@g.us" }),
    /no morning report group/,
  );
});
test("subcon's `enabled` governs only the morning report", () => {
  // It came back with the outbound route, but it is NOT the master switch:
  // treating it as one would report a project doing live intake as idle.
  assert.equal(hasCadence("subcon", {}), true, "both default on in Postgres");
  assert.equal(hasCadence("subcon", { enabled: false }), true, "intake still runs");
  assert.equal(hasCadence("subcon", { enable_housekeeping: false }), true, "the report still sends");
  assert.equal(hasCadence("subcon", { enabled: false, enable_housekeeping: false }), false);
});
test("issue chaser needs a style on, not just enabled", () => {
  // A CHECK refuses any style unless `enabled` is already true, so enabled-only
  // is a real and silent state: nothing is ever sent.
  assert.equal(hasCadence("issueChaser", { enabled: true }), false);
  assert.equal(hasCadence("issueChaser", { enabled: true, severity_cadence_chaser_enabled: true }), true);
  assert.match(firesAt("issueChaser", { enabled: true }), /No chaser style enabled/);

  const line = firesAt("issueChaser", { enabled: true, severity_cadence_chaser_enabled: true });
  assert.match(line, /P1 every 3h/);
  assert.match(line, /originating group/, "the usual destination is not a configured group");
  assert.match(
    firesAt("issueChaser", { severity_cadence_chaser_enabled: true, send_to_originating_groups: false }),
    /configured groups/,
  );
});

test("delivery groups keep each service's columns", () => {
  assert.deepEqual(deliveryGroups("wbgt", { whatsapp_group_id: "a@g.us, b@g.us" }), [
    { chatId: "a@g.us", role: undefined },
    { chatId: "b@g.us", role: undefined },
  ]);
  assert.deepEqual(deliveryGroups("haze", { wa_group_ids: "h@g.us" }), [{ chatId: "h@g.us", role: undefined }]);
  assert.deepEqual(deliveryGroups("ailytics", { whatsapp_group_ids: "x@g.us" }), [
    { chatId: "x@g.us", role: undefined },
  ]);
  assert.deepEqual(deliveryGroups("issueChaser", { whatsapp_group_ids: "i@g.us" }), [
    { chatId: "i@g.us", role: undefined },
  ]);

  // Subcon runs in both directions, so its groups are labelled — a card must not
  // imply that an inbound group receives the morning report.
  assert.deepEqual(
    deliveryGroups("subcon", { manpower_activity_outbound_group_id: "out@g.us", safety_group_ids: "in@g.us" }),
    [
      { chatId: "out@g.us", role: "morning report" },
      { chatId: "in@g.us", role: "inbound" },
    ],
  );
  assert.deepEqual(deliveryGroups("subcon", {}), []);

  // One chat serving two roles still collapses to a single entry.
  assert.deepEqual(
    deliveryGroups("wbgt", { whatsapp_group_id: "same@g.us", water_parade_outbound_group_id: "same@g.us" }),
    [{ chatId: "same@g.us", role: "water parade" }],
  );
});
test("the same spreadsheet_id column is labelled per service", () => {
  // Named for the document rather than a tab. It used to read "Daily Activity"
  // because that was the one tab this service wrote; since 9b45234 it writes
  // nothing and only reads `Manpower`, so a tab name would be doubly wrong.
  assert.deepEqual(
    autoLinks("subcon", { spreadsheet_id: "S1" }).map((l) => l.label),
    ["📗 Manpower workbook"],
  );
  assert.match(autoLinks("subcon", { spreadsheet_id: "S1" })[0].href, /spreadsheets\/d\/S1\/edit$/);

  assert.deepEqual(
    autoLinks("ailytics", { spreadsheet_id: "S1" }).map((l) => l.label),
    ["📗 Safety sheet"],
  );
  assert.deepEqual(
    autoLinks("issueChaser", { safety_sheet_id: "K1" }).map((l) => l.label),
    ["📗 Safety workbook"],
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
  // Subcon has no outbound surface at all now, so there is no such pill to show.
  assert.ok(!subconPills.some((p) => p.label === "outbound WhatsApp"), "superseded by the named routes");
  assert.ok(subconPills.some((p) => p.label === "housekeeping intake"));
  assert.ok(subconPills.some((p) => p.label === "morning report"), "the outbound route is its own pill");
  // Water Parade belongs to the WBGT service now, so subcon must not claim it.
  assert.ok(!subconPills.some((p) => /Water Parade/.test(p.label)));
  // enable_housekeeping defaults true in Postgres, so an absent flag reads as on.
  assert.ok(subconPills.some((p) => p.label === "housekeeping intake" && p.on), "defaults to on");
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
    // Subcon genuinely has no `enabled` column since the reduction, so injecting
    // one would test a shape that cannot occur.
    const { enabled, ...withoutEnabled } = columns;
    const base = key === "subcon" ? withoutEnabled : columns;
    const spec = buildFieldSpec(key, { ...base, ...(SERVICES[key].idColumn === "id" ? { id: identity } : {}) });

    // A missing READONLY entry would silently make the business key writable.
    for (const locked of ["project_code", "created_at", "updated_at"]) {
      assert.equal(spec.fields[locked]?.readonly, true, `${key}.${locked} must be read-only`);
    }
    assert.equal(spec.fields[SERVICES[key].idColumn]?.readonly, true, `${key} identity must be read-only`);

    // Audit stamps and the identity never belong in the editor.
    assert.equal(spec.fields.created_at?.hidden, true, `${key}.created_at must be hidden`);
    assert.equal(spec.fields.updated_at?.hidden, true, `${key}.updated_at must be hidden`);

    // `enabled` is meaningful for every service that HAS it — subcon's was
    // dropped when the repo was reduced, and its switch is enable_housekeeping.
    if (spec.fields.enabled) {
      assert.notEqual(spec.fields.enabled.label, "enabled", `${key}.enabled needs a label`);
    } else {
      assert.equal(key, "subcon", `${key} has no enabled column — only subcon should not`);
    }
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
    // Subcon routes in both directions again.
    safety_group_ids: "a@g.us",
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
  // Every group column is included by derivation from GROUP_COLUMNS, not by hand.
  for (const column of [
    "whatsapp_group_id",
    "wa_group_ids",
    "whatsapp_group_ids",
    // Subcon again has both an inbound routing column and an outbound one.
    "safety_group_ids",
    "manpower_activity_outbound_group_id",
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

// ---------------------------------------------------------------------------
// Manual photo ingestion: a live WBGT project with no cadence at all. Treating
// "no cadence" as "idle" greyed these out and sank them, which is what this
// three-way classification fixes.
// ---------------------------------------------------------------------------
const manualRow = {
  enabled: true,
  enable_scrape: false,
  whatsapp_wbgt_source_chat_ids: "120363000000000000@g.us",
};

test("manual ingestion needs all three conditions", () => {
  assert.equal(isManualIngestion("wbgt", manualRow), true);
  // Telegram photo sources count too — same section of the editor.
  assert.equal(
    isManualIngestion("wbgt", { enabled: true, enable_scrape: false, telegram_chat_ids: "-100123" }),
    true,
  );

  assert.equal(isManualIngestion("wbgt", { ...manualRow, enabled: false }), false, "a disabled project is not manual");
  assert.equal(
    isManualIngestion("wbgt", { ...manualRow, enable_scrape: true }),
    false,
    "the scraper still running means it is not manual",
  );
  // Scrape defaults to on, so an absent flag is not manual either.
  assert.equal(isManualIngestion("wbgt", { enabled: true, whatsapp_wbgt_source_chat_ids: "x@g.us" }), false);
  assert.equal(
    isManualIngestion("wbgt", { enabled: true, enable_scrape: false }),
    false,
    "no photo source means nothing arrives",
  );
  // Only WBGT ingests photos.
  assert.equal(isManualIngestion("noise", manualRow), false);
});

test("emphasis separates scheduled, manual and idle", () => {
  assert.equal(cardEmphasis("wbgt", { enable_hourly: true }), "active");
  assert.equal(cardEmphasis("wbgt", manualRow), "manual");
  // Scrape on but nothing sent: genuinely idle, keeps the full scrim.
  assert.equal(cardEmphasis("wbgt", { enabled: true, enable_scrape: true }), "idle");

  // A manual project outranks an idle one but not a scheduled one.
  assert.ok(emphasisRank("wbgt", manualRow) > emphasisRank("wbgt", { enabled: true }));
  assert.ok(emphasisRank("wbgt", { enable_hourly: true }) > emphasisRank("wbgt", manualRow));
});

test("a manual project does not claim there are no cadences", () => {
  assert.match(firesAt("wbgt", manualRow), /Manual photo ingestion/);
  assert.equal(firesAt("wbgt", { enabled: true }), "No cadences enabled");
  // A manual project that also messages hourly still describes the cadence.
  assert.match(firesAt("wbgt", { ...manualRow, enable_hourly: true }), /:00 hourly/);
  // hasCadence stays a pure "is anything scheduled" test.
  assert.equal(hasCadence("wbgt", manualRow), false);
});

// ---------------------------------------------------------------------------
// Jobs. Two things vary per job and must not be unified: the payload shape the
// endpoint expects, and the precondition that makes the job meaningful.
// ---------------------------------------------------------------------------
test("each job builds the payload its own endpoint expects", () => {
  const input = { projectCode: "ZRA", startDate: "2026-07-01", endDate: "2026-07-31" };

  // noise-sheet-bootstrap / noise-sheet-sync: snake_case, start_date/end_date.
  assert.deepEqual(JOBS["noise-bootstrap"].buildPayload(input), {
    project_code: "ZRA",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  });
  assert.deepEqual(JOBS["noise-sync"].buildPayload(input), {
    project_code: "ZRA",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  });
  // wbgt-sheet-fill: camelCase, and resolveDates() only enumerates a range when
  // given from + to.
  assert.deepEqual(JOBS["wbgt-fill"].buildPayload(input), {
    projectCode: "ZRA",
    from: "2026-07-01",
    to: "2026-07-31",
  });
});

test("the historical scrape always sends its mandatory opt-in", () => {
  const input = { projectCode: "MBS", startDate: "2026-08-01", endDate: "2026-08-05" };

  // parseScrapeRequest() rejects from/to without historical:true, and treats a
  // bare projectCode as a normal current-window scrape — so omitting this flag
  // would silently scrape today instead of the range.
  assert.deepEqual(JOBS["wbgt-scrape"].buildPayload(input), {
    historical: true,
    projectCode: "MBS",
    from: "2026-08-01",
    to: "2026-08-05",
  });

  // `force` only appears when asked for; the endpoint checks `force === true`.
  assert.deepEqual(JOBS["wbgt-scrape"].buildPayload({ ...input, flags: { force: true } }), {
    historical: true,
    projectCode: "MBS",
    from: "2026-08-01",
    to: "2026-08-05",
    force: true,
  });
  assert.equal("force" in JOBS["wbgt-scrape"].buildPayload({ ...input, flags: { force: false } }), false);
});

test("jobs are offered on the right tab", () => {
  assert.deepEqual(jobsForService("noise").map((j) => j.key), ["noise-bootstrap", "noise-sync"]);
  assert.deepEqual(jobsForService("wbgt").map((j) => j.key), [
    "wbgt-fill",
    "wbgt-scrape",
    "wbgt-water-parade",
  ]);
  for (const service of ["haze", "lightning", "ailytics", "subcon"] as const) {
    assert.deepEqual(jobsForService(service), [], service);
  }
});

test("a sheet id is recognised, and placeholders are not", () => {
  const real = "1LStoAHwBgdnXeTviMDgaPwV52gHm779YtzbgDUfQdvg";
  assert.equal(readSheetId(real), real);
  // A pasted URL is accepted, since that is what people copy.
  assert.equal(readSheetId(`https://docs.google.com/spreadsheets/d/${real}/edit#gid=0`), real);
  // The alert repos treat these literals as unset, and real rows contain them:
  // WCP's google_sheet_id is "-" and TBS's monthly_sheet_id is "".
  for (const bad of ["", "   ", "null", "NULL", "undefined", "blank", "empty", "-", "n/a", "too-short"]) {
    assert.equal(readSheetId(bad), null, JSON.stringify(bad));
  }
  assert.equal(readSheetId(null), null);
});

test("each job's precondition reads the thing that makes it meaningful", () => {
  const sheeted = { project_code: "X", google_sheet_id: "x".repeat(30), monthly_sheet_id: "y".repeat(30) };
  assert.ok(JOBS["noise-sync"].precondition.read(sheeted));
  assert.ok(JOBS["wbgt-fill"].precondition.read(sheeted));
  assert.equal(JOBS["noise-sync"].precondition.read({ google_sheet_id: "-" }), null);
  assert.equal(JOBS["wbgt-fill"].precondition.read({ monthly_sheet_id: "" }), null);

  // The scrape needs an upstream, not a sheet: enable_scrape defaults to on, so
  // only an explicit false blocks it. This is exactly the MANUAL projects.
  assert.ok(JOBS["wbgt-scrape"].precondition.read({}));
  assert.ok(JOBS["wbgt-scrape"].precondition.read({ enable_scrape: true }));
  assert.equal(JOBS["wbgt-scrape"].precondition.read({ enable_scrape: false }), null);
  assert.match(JOBS["wbgt-scrape"].precondition.unmet("AST"), /manual photo ingestion/i);
});

test("a job cannot be launched without a project, a valid range and its precondition", () => {
  const job = JOBS["noise-sync"];
  const ok = { projectCode: "ZRA", startDate: "2026-07-01", endDate: "2026-07-31" };
  assert.deepEqual(validateJobInput(ok, { job, ready: "sheet" }), []);

  assert.ok(validateJobInput(ok, { job, ready: null }).some((p) => /not configured/.test(p)));
  assert.ok(validateJobInput({ ...ok, projectCode: "" }, { job, ready: "sheet" }).some((p) => /Choose a project/.test(p)));
  assert.ok(
    validateJobInput({ ...ok, startDate: "2026-08-01" }, { job, ready: "sheet" }).some((p) =>
      /after the end date/.test(p),
    ),
  );
  // Real dates only: 31 February matches the shape but is not a date.
  assert.ok(validateJobInput({ ...ok, startDate: "2026-02-31" }, { job, ready: "sheet" }).some((p) => /YYYY-MM-DD/.test(p)));
  assert.ok(validateJobInput({ ...ok, endDate: "01-07-2026" }, { job, ready: "sheet" }).some((p) => /YYYY-MM-DD/.test(p)));
});

test("the scrape's 31-day cap is enforced before the round trip", () => {
  const job = JOBS["wbgt-scrape"];
  assert.equal(spanDays("2026-08-01", "2026-08-01"), 1, "inclusive");
  assert.equal(spanDays("2026-08-01", "2026-08-31"), 31);

  // 31 days is the endpoint's limit, not one less.
  assert.deepEqual(validateJobInput({ projectCode: "MBS", startDate: "2026-08-01", endDate: "2026-08-31" }, { job, ready: "enabled" }), []);
  const tooLong = validateJobInput(
    { projectCode: "MBS", startDate: "2026-08-01", endDate: "2026-09-01" },
    { job, ready: "enabled" },
  );
  assert.ok(tooLong.some((p) => /32 days; this job accepts at most 31/.test(p)), tooLong.join("; "));

  // The sheet jobs have no cap, so a long range is fine there.
  assert.deepEqual(
    validateJobInput({ projectCode: "ZRA", startDate: "2026-01-01", endDate: "2026-12-31" }, { job: JOBS["noise-sync"], ready: "sheet" }),
    [],
  );
});

test("job targets list every project, flagging the ones that cannot run", () => {
  const rows = [
    { project_code: "ZRB", google_sheet_id: "x".repeat(30) },
    { project_code: "ZRA", google_sheet_id: null },
    { project_code: "", google_sheet_id: "y".repeat(30) },
  ];
  const targets = jobTargets(JOBS["noise-sync"], rows);
  // Sorted, blank codes dropped, and an unmet precondition surfaced not hidden.
  assert.deepEqual(targets.map((t) => t.projectCode), ["ZRA", "ZRB"]);
  assert.equal(targets[0].ready, null);
  assert.ok(targets[1].ready);
});

// ---------------------------------------------------------------------------
// Outbound meter selection (noise_meters_included).
//
// Semantics mirror usecases/noise/outbound-meter-filter.js: comma-separated
// RecIDs, and blank means EVERY meter. The asymmetry that matters is that blank
// is not equivalent to listing every current RecID — see lib/meter-selection.ts.
// ---------------------------------------------------------------------------
const METERS = [
  { recId: "6408", name: "NM01 632B Senja Road RT" },
  { recId: "5771", name: "NM02 632A Senja Road RT" },
  { recId: "6440", name: "NM03 West View Primary School RT" },
];

test("the RecID list parses exactly as the noise service parses it", () => {
  // Matches parseIncludedNoiseMeterRecIds(" 1001, 1002, 1001 ") -> ["1001","1002"]
  assert.deepEqual(parseIncludedRecIds(" 1001, 1002, 1001 "), ["1001", "1002"]);
  assert.deepEqual(parseIncludedRecIds(",, ,"), []);
  assert.deepEqual(parseIncludedRecIds(null), []);
  assert.equal(includesEveryMeter(null), true);
  assert.equal(includesEveryMeter("  "), true);
  assert.equal(includesEveryMeter("6408"), false);
});

test("a blank column shows every meter enabled", () => {
  for (const blank of [null, "", "   "]) {
    const toggles = buildToggles(blank, METERS);
    assert.equal(toggles.length, 3);
    assert.ok(toggles.every((t) => t.enabled), JSON.stringify(blank));
  }
});

test("a populated column enables only the meters it names", () => {
  const toggles = buildToggles("5771,6440", METERS);
  assert.deepEqual(
    toggles.map((t) => [t.name.slice(0, 4), t.enabled]),
    [["NM01", false], ["NM02", true], ["NM03", true]],
  );
});

test("turning one meter off populates the column with the rest", () => {
  // From "all", switching NM01 off must name the two that remain.
  assert.equal(toggleMeter(buildToggles(null, METERS), "6408"), "5771,6440");
  // And switching it back on collapses to blank rather than listing all three,
  // so a meter added later is still included by default.
  assert.equal(toggleMeter(buildToggles("5771,6440", METERS), "6408"), "");
});

test("an exhaustive selection is stored as blank, not as every RecID", () => {
  const allOn = buildToggles("6408,5771,6440", METERS);
  assert.ok(allOn.every((t) => t.enabled));
  assert.equal(serializeSelection(allOn), "", "listing every id would freeze today's meter set");
});

test("a stale RecID is surfaced rather than silently dropped", () => {
  // The service logs [ERROR] and omits an unknown id; the operator needs to see
  // it to clean it up, and a toggle elsewhere must not rewrite it away.
  const toggles = buildToggles("5771,9999", METERS);
  const unknown = toggles.find((t) => t.recId === "9999");
  assert.equal(unknown?.issue, "unknown");
  assert.equal(unknown?.enabled, true);
  // Enabling every real meter still keeps the stale id, so nothing is discarded
  // behind the operator's back.
  assert.equal(serializeSelection(toggles.map((t) => ({ ...t, enabled: true }))), "6408,5771,6440,9999");
  // Switching the stale one off is what allows the collapse to blank.
  assert.equal(
    serializeSelection(toggles.map((t) => (t.recId === "9999" ? { ...t, enabled: false } : { ...t, enabled: true }))),
    "",
  );
});

test("a meter with no RecID is flagged, since no allowlist can name it", () => {
  const withOrphan = [...METERS, { recId: "", name: "NM04 unregistered" }];
  const blank = buildToggles(null, withOrphan);
  assert.equal(blank[3].issue, "no-rec-id");
  assert.equal(blank[3].enabled, true, "with no filter at all it is still sent");

  // The moment filtering starts it cannot be included — that is the trap.
  const filtered = buildToggles("6408", withOrphan);
  assert.equal(filtered[3].enabled, false);
  // It must never leak into the stored value as a blank entry.
  assert.equal(serializeSelection(blank), "");
  assert.equal(serializeSelection(filtered), "6408");
});

test("no meters at all means there is nothing to filter", () => {
  assert.deepEqual(buildToggles(null, []), []);
  assert.equal(serializeSelection([]), "");
});

test("the selection summary reads naturally on a card", () => {
  assert.equal(describeSelection(null, 7), "all 7 meters");
  assert.equal(describeSelection("6408,5771", 7), "2 of 7 meters");
  assert.equal(describeSelection(null, null), "all meters");
  assert.equal(describeSelection("6408", null), "1 meters only");
});

test("a meter filter reads as a caution, not as a switched-off feature", () => {
  // Blank is the norm on every project, so it earns no pill at all.
  assert.equal(
    pillsFor("noise", { noise_meters_included: null }).some((p) => /meter/.test(p.label)),
    false,
  );

  // A filter is ACTIVE, so `on` must be true — an off pill renders struck
  // through, which would read as "the filter is disabled", the opposite of true.
  const filtered = pillsFor("noise", { noise_meters_included: "6408,5771,6440,6439" });
  const pill = filtered.find((p) => /meter/.test(p.label));
  assert.equal(pill?.label, "4 meters only");
  assert.equal(pill?.on, true);
  // And it is a caution rather than a feature being on, so it is toned.
  assert.equal(pill?.tone, "warn");
});

// ---------------------------------------------------------------------------
// Exports. The bug worth pinning: an unanswered preflight is NOT "not ready".
// Treating them the same disabled the button while rendering nothing.
// ---------------------------------------------------------------------------
test("exports are offered on the right tab and target the right endpoint", () => {
  assert.deepEqual(exportsForService("wbgt").map((e) => e.key), ["wbgt-export"]);
  assert.deepEqual(exportsForService("noise").map((e) => e.key), ["noise-export"]);
  for (const service of ["haze", "lightning", "ailytics", "subcon"] as const) {
    assert.deepEqual(exportsForService(service), [], service);
  }
  assert.equal(EXPORTS["wbgt-export"].choose, "tab");
  // Noise exports the whole workbook: a pure read, so it needs no scratch copy.
  assert.equal(EXPORTS["noise-export"].choose, "workbook");
  assert.equal(EXPORTS["wbgt-export"].path, "/api/wbgt-sheet-export");
  assert.equal(EXPORTS["noise-export"].path, "/api/noise-sheet-sync".replace("sync", "export"));
});

test("every offered format preserves the sheet's appearance", () => {
  // PDF first: Google renders the page itself, so it is the most faithful.
  assert.deepEqual(EXPORT_FORMATS.map((entry) => entry.key), ["pdf", "xlsx"]);
  // Each carries the trade-off, since "any format that keeps the formatting"
  // is exactly the choice being made here.
  assert.ok(EXPORT_FORMATS.every((entry) => entry.label && entry.help));
});

test("readiness has three states, not two", () => {
  // The distinction the dialog relies on: `ready` must be a boolean for the
  // answer to count. Anything else means the service never reported, which has
  // to surface — that was the silent dead end.
  const answered = (ready: unknown) => typeof ready === "boolean";
  assert.equal(answered(true), true);
  assert.equal(answered(false), true);
  assert.equal(answered(undefined), false, "no report is not the same as not ready");
  assert.equal(answered(null), false);
});

// ---------------------------------------------------------------------------
// Water Parade (WBGT) and PENDING forwarding (Ailytics). Both are
// outbound-only switches: off does NOT mean the service is doing nothing, which
// is the thing the card has to avoid implying.
// ---------------------------------------------------------------------------
test("a Water Parade project is not idle even with every WBGT cadence off", () => {
  const wp = { enabled: true, water_parade_enabled: true };
  // It sends its own reminders, so it must not be scrimmed and sunk.
  assert.equal(hasCadence("wbgt", wp), true);
  assert.match(firesAt("wbgt", wp), /Water Parade reminders/);
  // And a project with neither is still idle.
  assert.equal(hasCadence("wbgt", { enabled: true }), false);
});

test("the Water Parade reminder group resolves as its own destination", () => {
  // Usually a DIFFERENT group from the WBGT alerts, so it needs its own label
  // and must reach the chat-name resolver.
  assert.deepEqual(
    deliveryGroups("wbgt", {
      whatsapp_group_id: "alerts@g.us",
      water_parade_outbound_group_id: "parade@g.us",
    }),
    [
      { chatId: "alerts@g.us", role: undefined },
      { chatId: "parade@g.us", role: "water parade" },
    ],
  );
  assert.ok(CHAT_ID_COLUMNS.includes("water_parade_outbound_group_id"));
  // One group serving both roles still collapses to a single chip.
  assert.deepEqual(
    deliveryGroups("wbgt", { whatsapp_group_id: "same@g.us", water_parade_outbound_group_id: "same@g.us" }),
    [{ chatId: "same@g.us", role: "water parade" }],
  );
});

test("the Water Parade rebuild names which of its three gates failed", () => {
  const job = JOBS["wbgt-water-parade"];
  const ok = {
    project_code: "TEST",
    enabled: true,
    water_parade_enabled: true,
    monthly_sheet_id: "M".repeat(30),
  };

  assert.match(job.precondition.read(ok) ?? "", /^writes to M{12}…$/);
  assert.equal(job.precondition.detail?.(ok, "TEST"), null);

  // Each gate fails differently, and none of them loudly, so each gets its own
  // sentence rather than a shared "not ready".
  assert.match(
    job.precondition.detail?.({ ...ok, enabled: false }, "TEST") ?? "",
    /project_not_found/,
  );
  assert.match(
    job.precondition.detail?.({ ...ok, water_parade_enabled: false }, "TEST") ?? "",
    /water_parade_disabled/,
  );
  // The quiet one: the run reports completed while writing nothing.
  assert.match(
    job.precondition.detail?.({ ...ok, monthly_sheet_id: null }, "TEST") ?? "",
    /Monthly sheet ID.*reported completed/s,
  );

  for (const broken of [
    { ...ok, enabled: false },
    { ...ok, water_parade_enabled: false },
    { ...ok, monthly_sheet_id: "" },
  ]) {
    assert.equal(job.precondition.read(broken), null);
  }
});

test("the Water Parade log lives in the monthly workbook, not the manpower one", () => {
  // syncCycleSheets() reads config.monthly_sheet_id. Gating on
  // manpower_spreadsheet_id would have passed projects that then wrote nothing.
  const job = JOBS["wbgt-water-parade"];
  const manpowerOnly = {
    project_code: "TEST",
    enabled: true,
    water_parade_enabled: true,
    monthly_sheet_id: null,
    manpower_spreadsheet_id: "P".repeat(30),
  };
  assert.equal(job.precondition.read(manpowerOnly), null);
});

test("the Water Parade rebuild sends the date pair the route documents", () => {
  const job = JOBS["wbgt-water-parade"];
  assert.deepEqual(
    job.buildPayload({ projectCode: "TEST", startDate: "2026-08-20", endDate: "2026-08-22" }),
    { projectCode: "TEST", fromDate: "2026-08-20", toDate: "2026-08-22" },
  );
  // dryRun is opt-in and omitted entirely when off, matching the other jobs.
  assert.deepEqual(
    job.buildPayload({
      projectCode: "TEST",
      startDate: "2026-08-20",
      endDate: "2026-08-22",
      flags: { dryRun: true },
    }),
    { projectCode: "TEST", fromDate: "2026-08-20", toDate: "2026-08-22", dryRun: true },
  );
  assert.equal(job.path, "/api/water-parade-rebuild");
  assert.equal(job.baseUrlEnv, "WBGT_API_URL");
  // No server-side span cap exists, so HALO must not claim one.
  assert.equal(job.maxSpanDays, undefined);
});

test("jobTargets carries the specific reason, and only when unmet", () => {
  const job = JOBS["wbgt-water-parade"];
  const targets = jobTargets(job, [
    { project_code: "READY", enabled: true, water_parade_enabled: true, monthly_sheet_id: "M".repeat(30) },
    { project_code: "OFF", enabled: true, water_parade_enabled: false, monthly_sheet_id: "M".repeat(30) },
  ]);
  const ready = targets.find((t) => t.projectCode === "READY");
  const off = targets.find((t) => t.projectCode === "OFF");
  assert.equal(ready?.reason, null, "a satisfied precondition has no reason to explain");
  assert.match(off?.reason ?? "", /water_parade_disabled/);
  // And validateJobInput surfaces it instead of the generic sentence.
  const problems = validateJobInput(
    { projectCode: "OFF", startDate: "2026-08-20", endDate: "2026-08-22" },
    { job, ready: off?.ready, reason: off?.reason },
  );
  assert.ok(problems.some((p) => /water_parade_disabled/.test(p)));
  assert.ok(!problems.some((p) => /is not ready for a Water Parade rebuild/.test(p)));
});

test("the manpower workbook is offered as its own link", () => {
  // Separate from the monthly sheet: it holds the Manpower tab and the Sender
  // Phone values used for PIC mentions.
  const links = autoLinks("wbgt", { monthly_sheet_id: "M".repeat(30), manpower_spreadsheet_id: "P".repeat(30) });
  assert.deepEqual(links.map((l) => l.label), ["📗 Monthly sheet", "📗 Manpower sheet"]);
  assert.match(links[1].href, /spreadsheets\/d\/P+\/edit$/);
});

test("both sheet links survive a project that points them at one workbook", () => {
  // Plausible setup: the Manpower tab kept inside the monthly workbook. The
  // cards used to key each link by href, so identical ids collided in React and
  // one of the two labels was dropped — they are keyed by label now.
  const same = autoLinks("wbgt", { monthly_sheet_id: "SAME", manpower_spreadsheet_id: "SAME" });
  assert.deepEqual(same.map((l) => l.label), ["📗 Monthly sheet", "📗 Manpower sheet"]);
  assert.equal(new Set(same.map((l) => l.label)).size, same.length, "labels must be unique to key by them");
  assert.equal(new Set(same.map((l) => l.href)).size, 1, "and this is the case href keying could not render");
});

test("Water Parade leads the pills, in its own colour, only when configured", () => {
  const pills = pillsFor("wbgt", { water_parade_enabled: true, enable_hourly: true });
  // FIRST, so it cannot be lost among the cadence switches — and toned rather
  // than a green tick, since it is a capability and not a cadence.
  assert.equal(pills[0].label, "💧 Water Parade");
  assert.equal(pills[0].tone, "info");
  assert.equal(pills[0].on, true);
  // Its cooldown rides directly behind it, because the two answer one question
  // together: does this site get asked, and how often.
  assert.equal(pills[1].label, "cooldown 2h");
  assert.equal(pills[1].on, false, "off by default");
  assert.equal(
    pillsFor("wbgt", { water_parade_enabled: true, water_parade_cooldown_enabled: true })[1].on,
    true,
  );
  // Then the cadence pills, in their usual order.
  assert.equal(pills[2].label, "hourly");

  // Not configured: both absent entirely. Most projects do not use Water Parade,
  // so struck-through pills on each would be noise rather than emphasis — and a
  // cooldown pill on a project with no cycles to cool down says nothing at all.
  for (const row of [
    { water_parade_enabled: false },
    {},
    // Even with the flag set, which happens when Water Parade is switched off
    // again and the cooldown is left behind.
    { water_parade_enabled: false, water_parade_cooldown_enabled: true },
  ]) {
    assert.equal(
      pillsFor("wbgt", row).some((p) => /Water Parade|cooldown/.test(p.label)),
      false,
      JSON.stringify(row),
    );
  }
});

test("the Water Parade cooldown is described where it changes the cadence", () => {
  const on = firesAt("wbgt", { water_parade_enabled: true, water_parade_cooldown_enabled: true });
  assert.match(on, /Water Parade reminders/);
  assert.match(on, /previous 2 hour bands/, "the suppression window belongs in words");
  // Same number as the pill: `cooldown 2h` and the sentence must not describe
  // the same rule with two different figures.
  assert.match(on, /2 hour bands/);

  const off = firesAt("wbgt", { water_parade_enabled: true });
  assert.match(off, /Water Parade reminders/);
  assert.doesNotMatch(off, /previous 2 hour bands/, "and must not be implied when it is off");

  // The flag alone changes nothing: cycle creation is what the cooldown gates.
  assert.doesNotMatch(firesAt("wbgt", { water_parade_cooldown_enabled: true }), /Water Parade|hour bands/);
});

test("Ailytics shows its two switches and not its setup", () => {
  const pills = pillsFor("ailytics", { forward_pending_to_whatsapp: true, status_summary_enabled: true });
  assert.ok(pills.some((p) => p.label === "forward PENDING" && p.on));
  assert.ok(pills.some((p) => p.label === "daily summary" && p.on));

  // Both are off by default and must read as off, not be omitted: an unlit
  // switch is the state someone needs to see before asking why no summary
  // arrived.
  const bare = pillsFor("ailytics", {});
  assert.ok(bare.some((p) => p.label === "forward PENDING" && !p.on));
  assert.ok(bare.some((p) => p.label === "daily summary" && !p.on));

  // `telegram source`, `sheet` and `whatsapp relay` were dropped: they were on
  // for every working project, so they reported that setup was finished rather
  // than anything an operator chose. Their return would be a regression.
  const configured = pillsFor("ailytics", {
    telegram_chat_id: "-1001",
    spreadsheet_id: "1abcdefghijklmnopqrstuvwxyz012345678901234",
    whatsapp_group_ids: "1203@g.us",
  });
  for (const gone of ["telegram source", "sheet", "whatsapp relay"]) {
    assert.ok(!configured.some((p) => p.label === gone), `${gone} should no longer be a pill`);
  }
  assert.equal(configured.length, 2, "exactly the two switches");
});

// ---------------------------------------------------------------------------
// Noise gained an evening summary (noise repo commit "Add evening noise
// summary"): the fixed 07:00-19:00 daytime closeout, scheduled at 19:00.
// ---------------------------------------------------------------------------
test("the evening closeout appears in the noise fires-at line", () => {
  const line = firesAt("noise", { enable_evening_summary: true });
  assert.match(line, /evening 7am–7pm closeout @ 19:00/);
  // It is opt-in, so an untouched project must not claim it.
  assert.doesNotMatch(firesAt("noise", { enable_hourly: true }), /evening/);
});

test("a project running only the evening closeout is not treated as idle", () => {
  // Without this, hasCadence returns false, the card is scrimmed and it sinks
  // to the bottom of the grid as though nothing were scheduled.
  assert.equal(hasCadence("noise", { enable_evening_summary: true }), true);
  assert.equal(hasCadence("noise", {}), false);
  assert.equal(cardEmphasis("noise", { enable_evening_summary: true }), "active");
});

test("the evening summary is surfaced as a pill", () => {
  const pills = pillsFor("noise", { enable_evening_summary: true });
  assert.ok(pills.some((p) => p.label === "evening summary" && p.on));
  assert.ok(pillsFor("noise", {}).some((p) => p.label === "evening summary" && !p.on));
});

test("company is offered on every service, as guidance rather than a constraint", () => {
  // Identity only: no code reads it. The column is plain nullable text with no
  // CHECK so a new company needs no migration — these values exist so the editor
  // can offer a dropdown and a typo is unlikely from the UI.
  assert.deepEqual([...COMPANIES], ["Wohhup", "Obayashi", "PentaOcean"]);

  const columns = {
    project_code: { type: "string" as const, format: "text", enum: null, default: null },
    created_at: { type: "string" as const, format: "text", enum: null, default: null },
    updated_at: { type: "string" as const, format: "text", enum: null, default: null },
    company: { type: "string" as const, format: "text", enum: null, default: null },
  };

  for (const key of SERVICE_KEYS) {
    const spec = buildFieldSpec(key, {
      ...columns,
      ...(SERVICES[key].idColumn === "id"
        ? { id: { type: "string" as const, format: "text", enum: null, default: null } }
        : {}),
    });
    const field = spec.fields.company;
    assert.ok(field, `${key} must accept a company column`);
    assert.notEqual(field.label, "company", `${key}.company needs a label`);
    // A select, so the three known values are offered rather than typed.
    assert.equal(field.widget, "select", `${key}.company should be a dropdown`);
    assert.deepEqual(field.options, [...COMPANIES], `${key}.company options`);
    assert.equal(field.readonly, false, "it is set by hand where instance_name does not imply one");
    // Placed, never swept into "Other".
    assert.ok(
      spec.groups.some((g) => g.title !== "Other" && g.fields.includes("company")),
      `${key}.company must be in a named group`,
    );
  }
});

test("an empty group list is not always a misconfiguration", () => {
  // Issue Chaser recovers the destination from the issue's own sheet row when
  // send_to_originating_groups is on, which is the default. Reporting "no group
  // configured" there describes a problem that does not exist.
  assert.deepEqual(deliveryGroups("issueChaser", {}), []);
  assert.deepEqual(deliveryGroups("issueChaser", { whatsapp_group_ids: "g@g.us" }), [
    { chatId: "g@g.us", role: undefined },
  ]);
  // The fires-at line is where that intent is stated in words.
  assert.match(
    firesAt("issueChaser", { severity_cadence_chaser_enabled: true }),
    /originating group/,
  );
  assert.match(
    firesAt("issueChaser", { severity_cadence_chaser_enabled: true, send_to_originating_groups: false }),
    /configured groups/,
  );
});

test("search matches a card's switched-on capabilities, not just its code", () => {
  // The question someone is really asking when they type into the filter is
  // "which projects have this?" — so an enabled pill has to be searchable.
  const withWaterParade = { project_code: "TEST", water_parade_enabled: true, enable_hourly: true };
  assert.equal(matchesQuery("wbgt", withWaterParade, "water parade"), true);
  assert.equal(matchesQuery("wbgt", withWaterParade, "WATER PARADE"), true, "case-insensitive");
  // The emoji on the label must not block a plain-text search.
  assert.ok(searchTokens("wbgt", withWaterParade).some((t) => t.includes("💧")));
});

test("a struck-through pill is NOT a match", () => {
  // This is the whole distinction: matching an off pill would return exactly the
  // projects the searcher does not want.
  //
  // It has to be tested with a pill that is EMITTED in both states. Water Parade
  // is not — it is omitted entirely when off — so asserting on that passed
  // whether or not the `pill.on` filter existed. "5-min alerts" is always
  // rendered, lit or struck through, which is what makes this a real guard.
  const row = { project_code: "ZRA", enable_hourly: true, enable_5min_alerts: false };
  const pills = pillsFor("wbgt", row);
  const fiveMin = pills.find((p) => p.label === "5-min alerts");
  assert.ok(fiveMin, "the pill must exist for this test to mean anything");
  assert.equal(fiveMin.on, false, "and it must be off");

  assert.equal(matchesQuery("wbgt", row, "5-min alerts"), false, "an off pill must not match");
  assert.equal(matchesQuery("wbgt", row, "hourly"), true, "an on pill still matches");
  assert.equal(
    searchTokens("wbgt", row).some((t) => t.includes("5-min")),
    false,
    "and it is absent from the tokens entirely",
  );
});

test("code and company still match, and an empty query matches everything", () => {
  const row = { project_code: "CRP", company: "Obayashi", amber_enabled: true };
  assert.equal(matchesQuery("lightning", row, "crp"), true);
  assert.equal(matchesQuery("lightning", row, "obayashi"), true);
  assert.equal(matchesQuery("lightning", row, ""), true);
  assert.equal(matchesQuery("lightning", row, "   "), true, "whitespace is not a filter");
  assert.equal(matchesQuery("lightning", row, "pentaocean"), false);
});

test("capability search works across every service", () => {
  // Each service names its own switches, so the feature is only useful if it
  // reaches all of them rather than the ones that happened to be tested.
  const cases = [
    { service: "wbgt" as const, row: { enable_5min_alerts: true }, needle: "5-min alerts" },
    { service: "noise" as const, row: { enable_morning_summary: true }, needle: "morning summary" },
    { service: "haze" as const, row: { four_hourly: true }, needle: "4-hourly" },
    { service: "lightning" as const, row: { enable_red_band_poc_mentions: true }, needle: "poc mentions" },
    { service: "ailytics" as const, row: { forward_pending_to_whatsapp: true }, needle: "forward pending" },
    { service: "subcon" as const, row: { enable_housekeeping: true }, needle: "housekeeping intake" },
    { service: "issueChaser" as const, row: { priority_one_escalation_enabled: true }, needle: "p1 escalation" },
  ];
  for (const { service, row, needle } of cases) {
    assert.equal(matchesQuery(service, row, needle), true, `${service} should match "${needle}"`);
  }
  // Every service is covered, so a new one cannot quietly miss out.
  assert.equal(cases.length, SERVICE_KEYS.length);
});

test("the search box advertises what it now accepts", async () => {
  // A capability filter nobody knows about is not a feature. The placeholder is
  // the only place a user learns this, so it is worth pinning.
  const shell = await readFile(resolve("components/DashboardShell.tsx"), "utf8");
  const placeholders = [...shell.matchAll(/placeholder="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(placeholders.length >= 2, "mobile and desktop each have one");
  for (const placeholder of placeholders) {
    assert.doesNotMatch(
      placeholder,
      /^Filter by project code…?$/,
      "the placeholder must not still claim code-only",
    );
  }
  assert.ok(
    placeholders.some((p) => /pill|capability/i.test(p)),
    `at least one placeholder should mention capabilities: ${JSON.stringify(placeholders)}`,
  );
});

test("a card tag uses the short service name where one exists", () => {
  // The tag sits beside a project code, so "Subcon Activities" and "Issue
  // Chaser" wrapped onto two lines. The tabs keep the full names.
  assert.equal(tagLabel("subcon"), "Subcon");
  assert.equal(tagLabel("issueChaser"), "Chaser");
  assert.equal(SERVICES.subcon.label, "Subcon Activities", "the tab is unchanged");
  assert.equal(SERVICES.issueChaser.label, "Issue Chaser", "the tab is unchanged");

  // Everything else falls through to its full label, so no service is nameless.
  for (const key of SERVICE_KEYS) {
    assert.ok(tagLabel(key).length > 0, `${key} needs a tag`);
    assert.ok(tagLabel(key).length <= 12, `${key} tag is too long for the card: ${tagLabel(key)}`);
  }
});

test("Issue Chaser's two new switches are on the card, both off by default", () => {
  // `origin required`, `images` and `PIC mentions` were asserted here until
  // their columns were retired from the service by 412256d — PIC resolution and
  // image delivery are built in now, and the single configured-group origin
  // fallback is unconditional. The assertion is therefore that they are GONE: a
  // pill for a setting that no longer exists sends someone hunting for a switch.
  const bare = pillsFor("issueChaser", {});
  const labels = bare.map((pill) => pill.label);
  for (const retired of ["origin required", "images", "PIC mentions"]) {
    assert.ok(!labels.includes(retired), `${retired} is no longer a setting and must not be a pill`);
  }

  // What remains is the one delivery switch the table still has.
  assert.ok(labels.includes("reply in origin group"));
  assert.equal(
    pillsFor("issueChaser", { send_to_originating_groups: false }).find(
      (pill) => pill.label === "reply in origin group",
    )?.on,
    false,
  );
});

test("the Woh Hup roster filter appears only where the Manpower tab is read", () => {
  // Default true, and it drops Woh Hup / Wohhup / WHPL rows when the Manpower
  // tab is parsed. It governs two consumers at once — the Water Parade roster
  // and manpower-sheet POC resolution — so it is shown for either.
  const parade = pillsFor("wbgt", { water_parade_enabled: true });
  assert.ok(parade.some((p) => p.label === "excl. Woh Hup" && p.on), "default is to exclude");

  const included = pillsFor("wbgt", { water_parade_enabled: true, exclude_wohhup_from_manpower: false });
  assert.ok(
    included.some((p) => p.label === "excl. Woh Hup" && !p.on),
    "struck through where Woh Hup counts as a participant — MBS today",
  );

  // POC numbers resolved from the sheet read the same tab, so the filter matters
  // there even with Water Parade off.
  const pocFromSheet = pillsFor("wbgt", { poc_phone_numbers: "manpower-sheet" });
  assert.ok(pocFromSheet.some((p) => p.label === "excl. Woh Hup"));

  // And nowhere else: on a project that never reads the tab the flag is inert,
  // and a pill on all 25 cards would carry no information.
  for (const row of [{}, { enable_hourly: true }, { poc_phone_numbers: "6591234567" }]) {
    assert.ok(
      !pillsFor("wbgt", row).some((p) => /Woh Hup/.test(p.label)),
      JSON.stringify(row),
    );
  }
});

/**
 * Every API route authenticates, swept from disk rather than from a list.
 *
 * A hand-kept list of routes to check is a list someone forgets to add to, and
 * the thing they forget is by definition the new one. So this walks
 * `app/api` itself: a route file that appears without a guard fails here on the
 * commit that adds it, which is the only moment the omission is cheap.
 */
test("every API route authenticates and gates on an allowed session", async () => {
  const { readdir } = await import("node:fs/promises");

  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(resolve(process.cwd(), dir), { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) found.push(...(await walk(`${dir}/${entry.name}`)));
      else if (entry.name === "route.ts") found.push(`${dir}/${entry.name}`);
    }
    return found;
  };

  const routes = await walk("app/api");
  assert.ok(routes.length >= 14, `expected the API routes, found ${routes.length}`);
  // The map's own route must be in the sweep — the sweep is worthless if the
  // walk quietly misses a subdirectory.
  assert.ok(
    routes.includes("app/api/lightning/detections/route.ts"),
    "the walk must reach nested routes",
  );

  /**
   * `/api/session` answers "who am I, and can the server see the allow-list".
   * Gating it on being allowed would make it useless to exactly the person who
   * needs it: someone who has been refused and is trying to find out why.
   */
  const ANSWERS_BEFORE_ALLOWED = new Set(["app/api/session/route.ts"]);

  for (const route of routes) {
    const source = await readFile(resolve(process.cwd(), route), "utf8");
    // Comments are stripped first: a route whose only mention of the guard is a
    // note explaining it is a route with no guard.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    assert.match(code, /getDashboardSession\(\)/, `${route} does not establish a session`);
    if (ANSWERS_BEFORE_ALLOWED.has(route)) continue;
    assert.match(
      code,
      /session\.allowed/,
      `${route} establishes a session but never checks whether it is allowed`,
    );
  }
});

test("the half-hourly warning relay reads as routing, not as another cadence", () => {
  const base = { enable_half_hourly: true, whatsapp_group_id: "main@g.us" };

  // The relay list is a delivery column, so its groups become chips — and the
  // role has to say the groups only get warnings. A bare chip would read as
  // another recipient of the whole half-hourly stream, which is the one thing
  // it is not.
  const groups = deliveryGroups("noise", {
    ...base,
    half_hourly_send_if_exceed: true,
    exceedance_half_hourly_wa_groups: "ops@g.us, super@g.us",
  });
  assert.deepEqual(groups, [
    { chatId: "main@g.us", role: undefined },
    { chatId: "ops@g.us", role: "half-hourly warnings only" },
    { chatId: "super@g.us", role: "half-hourly warnings only" },
  ]);

  // A group on both lists is one chip carrying the relay role, not two — the
  // service de-duplicates before sending, so showing it twice would claim a
  // second message that never goes out.
  assert.deepEqual(
    deliveryGroups("noise", {
      ...base,
      half_hourly_send_if_exceed: true,
      exceedance_half_hourly_wa_groups: "main@g.us",
    }),
    [{ chatId: "main@g.us", role: "half-hourly warnings only" }],
  );

  // The pill appears only when the relay is on. It is opt-in and off nearly
  // everywhere, so an always-present struck-through pill would spend a slot on
  // every noise card to say nothing.
  const labels = (config: Record<string, unknown>) =>
    pillsFor("noise", config).map((pill) => pill.label);
  assert.ok(!labels(base).includes("warning relay"), "off projects carry no pill at all");
  const relayPill = pillsFor("noise", { ...base, half_hourly_send_if_exceed: true }).find(
    (pill) => pill.label === "warning relay",
  );
  assert.ok(relayPill?.on, "the pill is only ever shown in its on state");
  assert.equal(relayPill?.tone, "info", "routing, not a cadence");

  // And it is searchable, because the search box reads the switched-on pills.
  assert.equal(matchesQuery("noise", { ...base, half_hourly_send_if_exceed: true }, "warning relay"), true);
  assert.equal(matchesQuery("noise", base, "warning relay"), false);

  // The cadence sentence says the half-hourly message has a second destination,
  // since that is a delivery fact someone reads that line for.
  assert.match(
    firesAt("noise", { ...base, half_hourly_send_if_exceed: true }),
    /half-hourly.*warnings relayed/,
  );
  assert.doesNotMatch(firesAt("noise", base), /relayed/);
});

test("a group-list change is reviewed as names, not as chat ids", () => {
  const names = {
    "1@g.us": "Noise tracking",
    "2@g.us": "ZRA - Subcon WSHE Matters",
    "3@g.us": "Wentilabs - WH trial platform",
  };

  // The ordinary case: one group swapped for another. Removed first, then
  // added, then what was left alone — the order someone checks a change in.
  assert.deepEqual(groupDelta("1@g.us, 3@g.us", "3@g.us, 2@g.us", names), [
    { chatId: "1@g.us", name: "Noise tracking", state: "removed" },
    { chatId: "2@g.us", name: "ZRA - Subcon WSHE Matters", state: "added" },
    { chatId: "3@g.us", name: "Wentilabs - WH trial platform", state: "kept" },
  ]);

  // Adding to an empty column, and clearing one entirely — the two ends of the
  // range, and the ones where a raw-id diff told you least.
  assert.deepEqual(groupDelta(null, "2@g.us", names), [
    { chatId: "2@g.us", name: "ZRA - Subcon WSHE Matters", state: "added" },
  ]);
  assert.deepEqual(groupDelta("2@g.us", "", names), [
    { chatId: "2@g.us", name: "ZRA - Subcon WSHE Matters", state: "removed" },
  ]);

  // An id with no alias keeps the id. It must not vanish or render blank: an
  // alias that has not been fetched is not a group that does not exist.
  assert.deepEqual(groupDelta("", "9@g.us", names), [
    { chatId: "9@g.us", name: "9@g.us", state: "added" },
  ]);

  // Reordering alone is not an addition or a removal.
  const reordered = groupDelta("1@g.us, 2@g.us", "2@g.us, 1@g.us", names);
  assert.deepEqual(
    reordered.map((entry) => entry.state),
    ["kept", "kept"],
  );

  // Arrays are accepted as well as the stored comma string, since PostgREST
  // hands back `text[]` columns as arrays.
  assert.deepEqual(groupDelta(["1@g.us"], ["1@g.us", "2@g.us"], names).map((e) => e.state), [
    "added",
    "kept",
  ]);
});

test("an invariant id cited in help text names a real invariant in that service's repo", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");

  // Help text that cites an invariant is only worth more than help text that
  // does not if the id resolves. A cited id that no longer exists sends the
  // reader to the service's AGENTS.md to look for something that is not there —
  // worse than saying nothing, and ids do get renumbered.
  //
  // Keyed on the id's own PREFIX rather than on which service block the help
  // sits in: the prefix already names the owning repo, so a citation copied into
  // the wrong service's field is caught too.
  const OWNER: Record<string, string> = {
    "INV-WBGT": "usecase-wohhup-wbgt-alerts",
    "INV-NOISE": "usecase-wohhup-noise-meter-alerts",
    "INV-HAZE": "usecase-haze-alerts",
    "INV-LTG": "usecase-lightning-alerts",
    "INV-AIL": "mdw-lambda-ailytics",
    "INV-HK": "usecase-wohhup-coy-housekeeping-waterparade",
    "INV-ICH": "usecase-issue-chaser",
  };

  const source = await readFile(resolve(process.cwd(), "lib/field-spec.ts"), "utf8");
  const cited = [...new Set(source.match(/INV-[A-Z]+-\d+/g) ?? [])];
  assert.ok(cited.length >= 5, `expected the spec to cite some invariants, found ${cited.length}`);

  const agents = new Map<string, string>();
  for (const id of cited) {
    const prefix = id.replace(/-\d+$/, "");
    const repo = OWNER[prefix];
    assert.ok(repo, `${id} has no known owning repo — add its prefix to OWNER`);

    if (!agents.has(repo)) {
      // A partial checkout is not a failure; the assertion is about ids that can
      // be checked at all.
      try {
        agents.set(repo, await readFile(resolve(process.cwd(), "..", repo, "AGENTS.md"), "utf8"));
      } catch {
        agents.set(repo, "");
      }
    }
    const text = agents.get(repo)!;
    if (!text) continue;
    assert.ok(text.includes(id), `field-spec.ts cites ${id}, which is not in ${repo}/AGENTS.md`);
  }

  // And the citation has to sit on the service it belongs to. Existence alone
  // let INV-LTG-10 be cited on a subcon field and pass, because that id is real
  // — just not lightning's business to explain a housekeeping column. Attributed
  // by slicing the FIELDS blocks, which are the service keys at two-space indent.
  const PREFIX: Record<string, string> = Object.fromEntries(
    Object.entries(OWNER).map(([prefix, repo]) => [repo, prefix]),
  );
  const SERVICE_REPO: Record<string, string> = {
    wbgt: "usecase-wohhup-wbgt-alerts",
    noise: "usecase-wohhup-noise-meter-alerts",
    haze: "usecase-haze-alerts",
    lightning: "usecase-lightning-alerts",
    ailytics: "mdw-lambda-ailytics",
    subcon: "usecase-wohhup-coy-housekeeping-waterparade",
    issueChaser: "usecase-issue-chaser",
  };

  const fieldsStart = source.indexOf("const FIELDS:");
  assert.notEqual(fieldsStart, -1, "FIELDS block not found — was it renamed?");
  const fieldsBody = source.slice(fieldsStart);
  const blocks = [...fieldsBody.matchAll(/^ {2}(\w+): \{$/gm)];
  assert.ok(blocks.length >= 7, `expected a FIELDS block per service, found ${blocks.length}`);

  for (const [index, block] of blocks.entries()) {
    const service = block[1];
    const repo = SERVICE_REPO[service];
    if (!repo) continue;
    const body = fieldsBody.slice(block.index!, blocks[index + 1]?.index ?? fieldsBody.length);
    const expected = PREFIX[repo];
    for (const id of new Set(body.match(/INV-[A-Z]+-\d+/g) ?? [])) {
      assert.equal(
        id.replace(/-\d+$/, ""),
        expected,
        `${service} help cites ${id}, which belongs to another service`,
      );
    }
  }
});

test("the issue-chaser card reads its configured cadence windows, not the retired fixed hours", () => {
  const base = { severity_cadence_chaser_enabled: true, send_to_originating_groups: true };

  // Unset is ROUND THE CLOCK. This is the reversal worth pinning: the card used
  // to state a fixed 07:00–19:00 for P2/P3, and when the window columns landed
  // `configuredWindow` began returning null for an unset pair — which
  // `isInSendWindow` treats as eligible. The old text became the opposite of the
  // truth for every project that had not set a window, which is all of them.
  const open = firesAt("issueChaser", base);
  assert.match(open, /P1 every 3h round the clock/);
  assert.match(open, /P2 daily and P3 weekly round the clock/);
  assert.doesNotMatch(open, /07:00–19:00/, "the retired fixed hours must not be claimed");

  // A configured window is shown, with the seconds Postgres appends trimmed off.
  const gated = firesAt("issueChaser", {
    ...base,
    severity_p1_window_start: "08:00:00",
    severity_p1_window_end: "20:00:00",
    severity_p2_p3_window_start: "07:30:00",
    severity_p2_p3_window_end: "19:00:00",
  });
  assert.match(gated, /P1 every 3h within 08:00–20:00/);
  assert.match(gated, /P2 daily and P3 weekly within 07:30–19:00/);

  // A half-set window is refused by a CHECK, but the service ALSO treats it as
  // never-due, so the card says that rather than rendering a blank range.
  const half = firesAt("issueChaser", { ...base, severity_p1_window_start: "08:00:00" });
  assert.match(half, /half-set window — nothing is due/);

  // The snapshot lookback only shows when it is doing something.
  const snap = (days: unknown) =>
    firesAt("issueChaser", { same_day_open_snapshot_enabled: true, include_days_before_snapshot: days });
  assert.doesNotMatch(snap(0), /previous/, "the default of 0 is today only, and says nothing extra");
  assert.match(snap(1), /covering the previous 1 day too/);
  assert.match(snap(3), /covering the previous 3 days too/);
});

test("subcon shows whether the roster excludes the main contractor", () => {
  const labels = (config: Record<string, unknown>) => pillsFor("subcon", config).map((pill) => pill.label);
  assert.ok(labels({}).includes("excl. Woh Hup"), "shown even at its default");

  // Default is exclude, so an absent column reads as on — matching the database,
  // where the column is `not null default true`.
  const dflt = pillsFor("subcon", {}).find((pill) => pill.label === "excl. Woh Hup");
  assert.equal(dflt?.on, true);
  assert.equal(dflt?.tone, "info");

  const included = pillsFor("subcon", { exclude_wohhup_from_manpower: false }).find(
    (pill) => pill.label === "excl. Woh Hup",
  );
  assert.equal(included?.on, false, "off means Woh Hup rows count towards the roster");
});

// ---------------------------------------------------------------------------
// Columns added to the service repos on 1 Sep 2026, not yet migrated into
// Supabase. HALO builds fields from live introspection, so the editor entries
// stay dormant until the migrations run — which makes "absent behaves exactly
// as today" the assertion that matters most here.
// ---------------------------------------------------------------------------

test("wbgt 5-min severity: a missing column reads as the historical orange", () => {
  // The live state right now. A blank is not "unset pending a choice", it is
  // the orange-only behaviour every project had before the column existed.
  assert.match(firesAt("wbgt", { enable_5min_alerts: true }), /5-min on 32\/33°C crossings/);
  assert.match(
    firesAt("wbgt", { enable_5min_alerts: true, five_min_alert_threshold: "orange" }),
    /5-min on 32\/33°C crossings/,
  );
});

test("wbgt 5-min severity changes which crossings the card claims", () => {
  assert.match(
    firesAt("wbgt", { enable_5min_alerts: true, five_min_alert_threshold: "yellow" }),
    /5-min on 31\/32\/33°C crossings/,
  );
  const red = firesAt("wbgt", { enable_5min_alerts: true, five_min_alert_threshold: "red" });
  assert.match(red, /5-min on 33°C crossings/);
  // The point of `red` is that 32 no longer sends; still saying so would be the
  // card telling an operator the opposite of what the site will receive.
  assert.doesNotMatch(red, /32/);
});

test("the 5-min severity pill shows only when it differs from the default", () => {
  const labels = (config: Record<string, unknown>) => pillsFor("wbgt", config).map((p) => p.label);
  const hasMin = (config: Record<string, unknown>) => labels(config).some((l) => l.startsWith("min "));

  // "min orange" on every card is noise — the pill exists to spot the odd one.
  assert.equal(hasMin({ enable_5min_alerts: true }), false);
  assert.equal(hasMin({ enable_5min_alerts: true, five_min_alert_threshold: "orange" }), false);

  assert.ok(labels({ enable_5min_alerts: true, five_min_alert_threshold: "yellow" }).includes("min yellow 31°C"));
  assert.ok(labels({ enable_5min_alerts: true, five_min_alert_threshold: "red" }).includes("min red 33°C"));

  // A threshold on a project with 5-min off governs nothing, so it is not shown.
  assert.equal(hasMin({ enable_5min_alerts: false, five_min_alert_threshold: "red" }), false);
});

test("an issue-chaser project running only a summary is not idle", () => {
  // Without this the card sinks to the bottom as "nothing scheduled" while it
  // messages a site at 08:00 every morning.
  assert.equal(hasCadence("issueChaser", {}), false);
  assert.equal(hasCadence("issueChaser", { daily_safety_summary_enabled: true }), true);
  assert.equal(hasCadence("issueChaser", { daily_safety_company_summary_enabled: true }), true);
});

test("summaries carry their own routing, never the chasers'", () => {
  const summaryOnly = firesAt("issueChaser", { daily_safety_summary_enabled: true });
  assert.match(summaryOnly, /past-days safety summary/);
  assert.match(summaryOnly, /always to the configured groups/);
  // A summary is never copied into an issue's origin group. Inheriting the
  // chaser suffix would name a destination the service does not use.
  assert.doesNotMatch(summaryOnly, /originating group/);

  // And the chaser keeps its own routing when both are on.
  const both = firesAt("issueChaser", {
    severity_cadence_chaser_enabled: true,
    daily_safety_summary_enabled: true,
  });
  assert.match(both, /replies in each issue's originating group/);
  assert.match(both, /always to the configured groups/);
});

test("the summary window is read from summary_days and defaults to five", () => {
  const line = (extra: Record<string, unknown>) =>
    firesAt("issueChaser", { daily_safety_summary_enabled: true, ...extra });
  assert.match(line({}), /over 5 days/);
  assert.match(line({ summary_days: 1 }), /over 1 day\b/);
  assert.match(line({ summary_days: 14 }), /over 14 days/);
  // The database refuses 0 (issue_chaser_summary_days_check); the card should
  // fall back rather than print a window that cannot exist.
  assert.match(line({ summary_days: 0 }), /over 5 days/);
});

test("both summary flags produce their own pills", () => {
  const labels = (config: Record<string, unknown>) => pillsFor("issueChaser", config).map((p) => p.label);
  assert.ok(!labels({}).includes("daily summary"));
  assert.ok(labels({ daily_safety_summary_enabled: true }).includes("daily summary"));
  assert.ok(labels({ daily_safety_company_summary_enabled: true }).includes("summary by company"));
});

test("summary_days stays reachable from either summary flag", () => {
  // Hiding it behind just one flag would leave it unreachable for a project
  // running only the other — the reason `showIf` grew an `anyOf` at all.
  const column = { type: "boolean", format: "boolean", enum: null, default: null };
  const spec = buildFieldSpec("issueChaser", {
    daily_safety_summary_enabled: column,
    daily_safety_company_summary_enabled: column,
    summary_days: { type: "integer", format: "int4", enum: null, default: 5 },
  });
  const showIf = spec.fields.summary_days?.showIf;
  assert.ok(showIf && "anyOf" in showIf, "summary_days must depend on either flag, not one");
  assert.deepEqual(
    showIf.anyOf.map((c) => c.field).sort(),
    ["daily_safety_company_summary_enabled", "daily_safety_summary_enabled"],
  );
});

test("the dormant columns render correctly once the migrations land", () => {
  // These cannot be seen in the running app yet, so assert the shape the
  // editor will build the moment introspection starts returning them.
  const wbgt = buildFieldSpec("wbgt", {
    enable_5min_alerts: { type: "boolean", format: "boolean", enum: null, default: false },
    // As a pg enum, which is how migrate_five_min_alert_threshold.sql leaves it.
    five_min_alert_threshold: {
      type: "string",
      format: "wbgt_5min_alert_threshold",
      enum: ["yellow", "orange", "red"],
      default: null,
    },
  });
  const threshold = wbgt.fields.five_min_alert_threshold;
  assert.equal(threshold.widget, "select");
  assert.deepEqual(threshold.options, ["yellow", "orange", "red"]);
  assert.equal(threshold.readonly, false);
  // Hidden until 5-min alerts are on: it governs nothing otherwise.
  assert.deepEqual(threshold.showIf, { field: "enable_5min_alerts", equals: true });
  assert.ok(
    wbgt.groups.some((g) => g.fields.includes("five_min_alert_threshold")),
    "must be grouped, not stranded under Other",
  );

  // The same column half-migrated — still plain text, before the type swap.
  // CHECK_ENUMS has to carry it or the editor offers free text on a column the
  // database will reject.
  const halfway = buildFieldSpec("wbgt", {
    five_min_alert_threshold: { type: "string", format: "text", enum: null, default: null },
  });
  assert.deepEqual(halfway.fields.five_min_alert_threshold.options, ["yellow", "orange", "red"]);

  const chaser = buildFieldSpec("issueChaser", {
    daily_safety_summary_enabled: { type: "boolean", format: "boolean", enum: null, default: false },
    daily_safety_company_summary_enabled: { type: "boolean", format: "boolean", enum: null, default: false },
    summary_days: { type: "integer", format: "int4", enum: null, default: 5 },
  });
  assert.equal(chaser.fields.daily_safety_summary_enabled.widget, "toggle");
  assert.equal(chaser.fields.summary_days.widget, "number");
  // Their own group: a summary reads the workbook and chases nobody, so filing
  // it under "Chaser styles" would misdescribe what it does.
  const group = chaser.groups.find((g) => g.fields.includes("daily_safety_summary_enabled"));
  assert.equal(group?.title, "Daily summaries");
  assert.ok(!chaser.groups.some((g) => g.title === "Other"), "none may fall through to Other");
});
