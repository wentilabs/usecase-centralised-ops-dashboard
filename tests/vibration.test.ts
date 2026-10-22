import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { activityFor } from "../lib/data-health-activity";
import { assessIngestionHealth, healthTarget } from "../lib/data-health";
import { SERVICES } from "../lib/services";
import { vibrationTableForProject } from "../lib/onboarding/naming";
import { vibrationOnboarding } from "../lib/onboarding/providers/vibration";
import { buildInsertRow } from "../lib/onboarding/row-plan";

/**
 * Vibration shares `vibration_project_configs` with 277 legacy WIRS targets. The
 * failure these guard is a card per legacy target, or a site row created as the
 * wrong kind and never shown.
 */

test("only site rows are listed, read, patched and created", async () => {
  assert.deepEqual(SERVICES.vibration.rowFilter, { column: "config_kind", value: "site" });
  const repo = await readFile(resolve("lib/config-repository.ts"), "utf8");
  // One filter helper feeds both reads, and the two writes carry their own.
  assert.equal((repo.match(/rowFilterParam\(service\)/g) ?? []).length, 2, "list and get both filter");
  assert.match(repo, /const only = SERVICES\[service\]\.rowFilter;\s*if \(only\) params\.push/, "update filters");
  assert.match(repo, /\[rowFilter\.column\]: rowFilter\.value/, "insert forces the kind");
});

test("the readings table is named by the database's own rule, and refuses what it refuses", () => {
  assert.equal(vibrationTableForProject("SKW"), "skw_vibration_data_daily");
  assert.equal(vibrationTableForProject("C991-SGB"), "c991_sgb_vibration_data_daily");
  // The SQL function raises on these, so a name derived here would point at nothing.
  for (const bad of ["skw", "1SKW", "SK_W", "", "A".repeat(33)]) {
    assert.equal(vibrationTableForProject(bad), null, bad);
    assert.equal(healthTarget("vibration", bad), null, bad);
  }
});

test("a site is judged on when its newest reading was INGESTED, round the clock", () => {
  const target = healthTarget("vibration", "SKW")!;
  assert.equal(target.receivedField, "ingested_at");
  assert.equal(target.schema, "vibration");
  // `enabled = false` does not stop scraping, so it must not make a site idle.
  const activity = activityFor("vibration", { project_code: "SKW", enabled: false }, new Date("2026-10-18T03:00:00Z"));
  assert.equal(activity.state, "active", "a Sunday, 11:00 SGT, enabled off");

  const now = new Date("2026-10-21T10:00:00Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const verdict = (hoursAgo: number) =>
    assessIngestionHealth(target, { kind: "row", createdAt: at(hoursAgo), sourceEventAt: at(hoursAgo + 1) }, now, activity);
  assert.equal(verdict(1).tone, "good");
  assert.equal(verdict(7).tone, "stale");
  assert.equal(verdict(7).label, "Data: delayed");
  assert.equal(verdict(13).label, "Data: no recent data");
  assert.match(verdict(7).evidence?.join(" ") ?? "", /Seen: the newest reading arrived 7 h ago/);
});

test("a new site is a disabled site row with the identity the contract asks for", () => {
  const row = buildInsertRow(vibrationOnboarding, { project_code: "SKW", company: "Soilbuild", site_name: "Seletar West Road-3" });
  assert.equal(row.enabled, false);
  assert.equal(row.project_code, "SKW");
  assert.equal(row.site_name, "Seletar West Road-3");
  assert.equal(row.timezone, "Asia/Singapore");
  assert.ok(vibrationOnboarding.codePattern.test("SKW") && !vibrationOnboarding.codePattern.test("skw"));
  // The kind is forced where the row is written, not asked for in the form.
  assert.equal(vibrationOnboarding.fields.some((field) => field.column === "config_kind"), false);
});

test("services whose projects need something made first say so, and only those", async () => {
  const { onboardingFor } = await import("../lib/onboarding");
  const { SERVICE_KEYS } = await import("../lib/services");
  const declared = SERVICE_KEYS.filter((key) => onboardingFor(key)?.prerequisites?.length);
  assert.deepEqual(declared, ["noise", "vibration"]);

  const source = vibrationOnboarding.prerequisites![0];
  assert.deepEqual(source.filter("SKW"), { prepared_project_code: "eq.SKW", enabled: "eq.true" });
  assert.match(source.missing, /vibration_source_targets/);

  const noise = onboardingFor("noise")!.prerequisites![0];
  assert.deepEqual(noise.filter("CR106"), { project_code: "eq.CR106", active: "eq.true" });
  assert.match(noise.missing, /noise_limits/);
});

test("a prerequisite warns and never blocks, and a failed read is not reported as missing", async () => {
  const dialog = await readFile(resolve("components/OnboardDialog.tsx"), "utf8");
  // Missing, met and could-not-check are three different lines.
  for (const state of ["missing", "met", "unknown"]) assert.match(dialog, new RegExp(`data-prerequisite="${state}"`));
  assert.match(dialog, /item\.met === false/);
  assert.doesNotMatch(dialog, /disabled=\{[^}]*prereq/, "a prerequisite must not disable the create button");

  const repo = await readFile(resolve("lib/config-repository.ts"), "utf8");
  assert.match(repo, /return res\.ok \? [^;]*: null;/, "an unreadable table answers null, not false");
  const route = await readFile(resolve("app/api/onboard/[service]/prerequisites/route.ts"), "utf8");
  assert.match(route, /definition\.codePattern\.test\(code\)/, "a malformed code is never sent to the database");
});

test("Data Health recipients are not drawn as delivery chips, but stay a group column", async () => {
  const { deliveryGroups, groupColumnsFor } = await import("../lib/card-summary/groups");
  for (const service of ["wbgt", "noise"] as const) {
    const groups = deliveryGroups(service, { whatsapp_group_id: "site@g.us", data_health_group_ids: "dev@g.us" });
    assert.deepEqual(groups.map((group) => group.chatId), ["site@g.us"], service);
    // Still registered, so names resolve and a chat-driven bulk edit still reaches them.
    assert.ok(groupColumnsFor(service).some((entry) => entry.column === "data_health_group_ids"), service);
  }
});

test("the modal shows where a site's readings come from, and claims no message it does not send", async () => {
  const { hasPreview } = await import("../lib/message-previews");
  const { buildFieldSpec } = await import("../lib/field-spec");
  // The service's only message reads legacy WIRS rows, never a site row, so there is no
  // `?` to offer: a preview here would describe something a site cannot send.
  assert.equal(hasPreview("vibration", "enabled"), false);

  // `enabled` is the first control, as everywhere, and says what it gates: scraping.
  const bool = { type: "boolean" as const, format: "boolean", enum: null, default: false };
  const text = { type: "string" as const, format: "text", enum: null, default: null };
  const spec = buildFieldSpec("vibration", { enabled: bool, company: text, site_name: text, timezone: text, wa_group_ids: text, lambda_url: text });
  assert.equal(spec.groups[0].fields[0], "enabled");
  assert.equal(spec.fields.enabled.label, "Project enabled");
  assert.match(spec.fields.enabled.help, /Master switch for scraping/);
  assert.match(spec.fields.enabled.help, /sends no WhatsApp message/);
  // Delivery columns nothing reads for a site are not offered for editing.
  assert.equal(spec.fields.wa_group_ids.hidden && spec.fields.lambda_url.hidden, true);

  const editor = await readFile(resolve("components/ConfigEditor.tsx"), "utf8");
  assert.match(editor, /service === "vibration" \? <VibrationSource code=\{rowId\} \/>/);
  // A failed read is its own line, and never says there is no source.
  const panel = await readFile(resolve("components/VibrationSource.tsx"), "utf8");
  assert.match(panel, /Could not read this site's source targets/);
  assert.match(panel, /sources === null/);
});

test("the card says whether a site is being scraped, and the sources panel survives a disabled site", async () => {
  const { vibrationPills } = await import("../lib/card-summary/pill-providers/vibration");
  const { vibrationScheduleProvider } = await import("../lib/card-summary/schedule-providers/vibration");
  const on = vibrationPills({ project_code: "SKW", enabled: true, site_name: "Seletar West Road-3", timezone: "Asia/Singapore" });
  const off = vibrationPills({ project_code: "SKW", enabled: false, site_name: "Seletar West Road-3", timezone: "Asia/Singapore" });
  assert.equal(on.find((pill) => pill.label === "scraping")?.on, true);
  assert.equal(off.find((pill) => pill.label === "scraping")?.on, false);
  assert.match(vibrationScheduleProvider.firesAt({ project_code: "SKW", enabled: false }), /not scraped while the project is disabled/);
  assert.doesNotMatch(vibrationScheduleProvider.firesAt({ project_code: "SKW", enabled: true }), /not scraped/);

  // The gated view drops a disabled site, so the panel must read the registry itself or it
  // would report "no source" for exactly the site you are about to enable.
  const repo = await readFile(resolve("lib/config-repository.ts"), "utf8");
  const reader = repo.slice(repo.indexOf("export async function listVibrationSources"));
  const call = reader.split("\n").find((line) => line.includes("await request("));
  assert.match(call ?? "", /`vibration_source_targets\?\$\{query\}`/);
  assert.doesNotMatch(call ?? "", /vibration_project_source_targets/);
});
