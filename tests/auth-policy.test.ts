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
import { EXPORT_FORMATS, EXPORTS, JOBS, exportsForService, jobTargets, jobsForService, readSheetId, spanDays, validateJobInput } from "../lib/jobs";
import {
  buildToggles,
  describeSelection,
  includesEveryMeter,
  parseIncludedRecIds,
  serializeSelection,
  toggleMeter,
} from "../lib/meter-selection";
import { SERVICE_KEYS, SERVICES } from "../lib/services";
import {
  autoLinks,
  cardEmphasis,
  CHAT_ID_COLUMNS,
  chatIdsIn,
  deliveryGroups,
  emphasisRank,
  firesAt,
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
  assert.deepEqual(jobsForService("wbgt").map((j) => j.key), ["wbgt-fill", "wbgt-scrape"]);
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

test("the manpower workbook is offered as its own link", () => {
  // Separate from the monthly sheet: it holds the Manpower tab and the Sender
  // Phone values used for PIC mentions.
  const links = autoLinks("wbgt", { monthly_sheet_id: "M".repeat(30), manpower_spreadsheet_id: "P".repeat(30) });
  assert.deepEqual(links.map((l) => l.label), ["📗 Monthly sheet", "📗 Manpower sheet"]);
});

test("Water Parade leads the pills, in its own colour, only when configured", () => {
  const pills = pillsFor("wbgt", { water_parade_enabled: true, enable_hourly: true });
  // FIRST, so it cannot be lost among the cadence switches — and toned rather
  // than a green tick, since it is a capability and not a cadence.
  assert.equal(pills[0].label, "💧 Water Parade");
  assert.equal(pills[0].tone, "info");
  assert.equal(pills[0].on, true);
  // The cadence pills still follow in their usual order.
  assert.equal(pills[1].label, "hourly");

  // Not configured: absent entirely. 24 of 25 projects do not use it, so a
  // struck-through pill on each would be noise rather than emphasis.
  for (const row of [{ water_parade_enabled: false }, {}]) {
    assert.equal(
      pillsFor("wbgt", row).some((p) => /Water Parade/.test(p.label)),
      false,
      JSON.stringify(row),
    );
  }
});

test("Ailytics PENDING forwarding is shown as the outbound-only switch it is", () => {
  const pills = pillsFor("ailytics", { forward_pending_to_whatsapp: true });
  assert.ok(pills.some((p) => p.label === "forward PENDING" && p.on));
  assert.ok(pillsFor("ailytics", {}).some((p) => p.label === "forward PENDING" && !p.on));
});
