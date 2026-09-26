import { test } from "node:test";
import assert from "node:assert/strict";

import { healthKey } from "../lib/data-health";
import { listProjectHealth } from "../lib/data-health-reader";

const NOW = new Date("2026-09-26T12:00:00.000Z"); // 20:00 SGT

/**
 * A project that is actually due to produce something at NOW.
 *
 * The evidence reader only queries a project inside one of its cadence hours —
 * outside them nothing is expected, so there is nothing a table could tell us.
 * These fixtures were bare `{ project_code }` rows, which read as dormant and
 * would now be skipped, so each carries the minimum configuration that puts
 * 20:00 inside its window. WBGT needs site hours that reach it; noise's hourly
 * cadence has no window set and therefore runs all day.
 */
const active = (projectCode: string, service: "wbgt" | "noise") => ({
  project_code: projectCode,
  enabled: true,
  whatsapp_group_id: "120363000000000000@g.us",
  enable_hourly: true,
  ...(service === "wbgt" ? { site_hours_start: 8, site_hours_end: 21 } : {}),
});

test("the health reader fetches only the newest narrow WBGT and Noise evidence rows", async () => {
  const calls: Array<{ url: string; profile: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, profile: new Headers(init?.headers).get("Accept-Profile") });
    if (url.includes("c_991_wbgt_data_hourly")) {
      return Response.json([{ created_at: "2026-09-26T11:30:00.000Z", reading_timestamp: "2026-09-26T11:00:00.000Z" }]);
    }
    return Response.json([{ created_at: "2026-09-26T11:30:00.000Z", date: "2026-09-26", time_hhmm: "11:30" }]);
  };

  const health = await listProjectHealth(
    {
      wbgt: [active("C 991", "wbgt")],
      noise: [active("CR 106", "noise")],
      haze: [active("C 991", "wbgt")],
    },
    { fetchImpl, now: NOW, url: "https://health.example", key: "test-key" },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.profile).sort(), ["noise-meters", "wbgts"]);
  assert.match(calls.find((call) => call.url.includes("c_991_wbgt_data_hourly"))!.url, /select=created_at%2Creading_timestamp&order=created_at.desc&limit=1/);
  assert.match(calls.find((call) => call.url.includes("cr_106_noise_data_daily"))!.url, /select=created_at%2Cdate%2Ctime_hhmm&order=created_at.desc&limit=1/);
  assert.equal(health.get(healthKey("wbgt", "C 991"))?.tone, "good");
  assert.equal(health.get(healthKey("noise", "CR 106"))?.tone, "good");
  assert.equal(health.has(healthKey("haze", "C 991")), false);
});

test("a missing table or failed sibling query becomes that card's result without erasing healthy evidence", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("mbs_wbgt_data_hourly")) {
      return Response.json({ code: "PGRST205" }, { status: 404 });
    }
    if (url.includes("wcp_noise_data_daily")) throw new Error("socket timed out");
    return Response.json([{ created_at: "2026-09-26T11:30:00.000Z", reading_timestamp: "2026-09-26T11:00:00.000Z" }]);
  };

  const health = await listProjectHealth(
    {
      wbgt: [active("C991", "wbgt"), active("MBS", "wbgt")],
      noise: [active("WCP", "noise")],
    },
    { fetchImpl, now: NOW, url: "https://health.example", key: "test-key" },
  );

  assert.equal(health.get(healthKey("wbgt", "C991"))?.label, "Data: receiving");
  assert.equal(health.get(healthKey("wbgt", "MBS"))?.label, "Data: table unavailable");
  assert.equal(health.get(healthKey("noise", "WCP"))?.label, "Data: monitor unavailable");
});

test("only a PostgREST undefined-table response is a table failure", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("mbs_wbgt_data_hourly")) return Response.json({ code: "not_found" }, { status: 404 });
    return Response.json({ error: "unexpected response" });
  };

  const health = await listProjectHealth(
    {
      wbgt: [active("MBS", "wbgt")],
      noise: [active("WCP", "noise")],
    },
    { fetchImpl, now: NOW, url: "https://health.example", key: "test-key" },
  );

  assert.equal(health.get(healthKey("wbgt", "MBS"))?.label, "Data: monitor unavailable");
  assert.equal(health.get(healthKey("noise", "WCP"))?.label, "Data: monitor unavailable");
});
