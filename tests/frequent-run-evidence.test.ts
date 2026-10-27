import assert from "node:assert/strict";
import test from "node:test";

import { collectFrequentRunEvidence } from "../lib/frequent-run-evidence";
import { missingFrequentRunEntries } from "../lib/scheduled-run-health";

test("Vibration's HTTP scheduled scrape clears a stale cron-only missing-run issue", async () => {
  const filters: string[] = [];
  const evidence = await collectFrequentRunEvidence("2026-10-27T03:30:00Z", async (path, schema) => {
    if (schema !== "vibration") return { ok: true, body: [] };
    const filter = new URLSearchParams(path.split("?")[1]).get("invocation_type") ?? "";
    filters.push(filter);
    return { ok: true, body: [{ started_at: filter.includes("manual")
      ? "2026-10-27T03:19:46Z" : "2026-07-28T09:55:14Z" }] };
  });
  assert.deepEqual(filters, ["in.(cron,manual)"]);
  assert.deepEqual(missingFrequentRunEntries({ vibration: [{ enabled: true, updated_at: "2026-07-01T00:00:00Z" }] }, evidence), []);
});
