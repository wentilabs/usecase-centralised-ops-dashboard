import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { validateWbgtSensorLabel } from "../lib/wbgt-sensor-label";

test("accepts the exact CloudLynx WC code label without rewriting it", () => {
  assert.deepEqual(validateWbgtSensorLabel("(WC-74)"), { ok: true });
});

test("rejects blank, edge-padded, overlong, and control-character sensor labels", () => {
  assert.equal(validateWbgtSensorLabel("  ").ok, false);
  assert.equal(validateWbgtSensorLabel(" (WC-74)").ok, false);
  assert.equal(validateWbgtSensorLabel("(WC-74) ").ok, false);
  assert.equal(validateWbgtSensorLabel("x".repeat(201)).ok, false);
  assert.equal(validateWbgtSensorLabel("WC-74\nother").ok, false);
});

test("the one-time migration keeps label and MBS mapping renames atomic and audited", async () => {
  const sql = await readFile(resolve("supabase/wbgt_sensor_label_editor.sql"), "utf8");
  assert.match(sql, /add column if not exists updated_at timestamptz not null default now\(\)/i);
  assert.match(sql, /before update on "wbgts"\.wbgt_sensors/i);
  assert.match(sql, /after update on "wbgts"\.wbgt_sensors[\s\S]*?ops\.record_config_change\('id'\)/i);
  assert.match(sql, /for update[\s\S]*sensor_delivery_groups[\s\S]*set sensor_label = p_sensor_label/i);
  assert.match(sql, /groups \? p_sensor_label[\s\S]*'mapping_conflict'/i);
  assert.match(sql, /revoke all on function ops\.rename_wbgt_sensor_label[\s\S]*grant execute[\s\S]*to service_role/i);
});

test("the project editor exposes the sensor-label UI only on WBGT projects", async () => {
  const source = await readFile(resolve("components/ConfigEditor.tsx"), "utf8");
  assert.match(source, /service === "wbgt"[\s\S]*?<WbgtSensorLabelEditor/);
});

test("basic sensor editing needs no new column and updates only the label the editor read", async () => {
  const repository = await readFile(resolve("lib/config-repository.ts"), "utf8");
  const route = await readFile(resolve("app/api/wbgt-sensors/route.ts"), "utf8");
  assert.match(repository, /select=id,sensor_label,site_name&active=is\.true/);
  assert.match(repository, /sensor_label=eq\.\$\{encodeURIComponent\(input\.baseSensorLabel\)\}/);
  assert.match(route, /baseSensorLabel in mappings \|\| newSensorLabel in mappings/);
  assert.match(route, /renameWbgtSensorLabelDirect/);
});
