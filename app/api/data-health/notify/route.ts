import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { listEstateHealth, listProjectFaults, listProjectStrips, listServiceNotices } from "@/lib/config-repository";
import { healthAlerts } from "@/lib/health-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const expected = process.env.HALO_DATA_HEALTH_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (expected.length < 32 || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function settings() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  const sender = process.env.HALO_DATA_HEALTH_SEND_URL;
  const group = process.env.HALO_DATA_HEALTH_GROUP_ID;
  const clientId = process.env.HALO_DATA_HEALTH_CLIENT_ID;
  const instanceName = process.env.HALO_DATA_HEALTH_INSTANCE_NAME;
  const listenerToken = process.env.HALO_DATA_HEALTH_LISTENER_TOKEN;
  if (!url || !key || !sender || !/^https:\/\//.test(sender) || !group || !clientId || !instanceName || !listenerToken) {
    throw new Error("HALO Data Health sender or Supabase settings are incomplete");
  }
  return { url, key, sender, group, clientId, instanceName, listenerToken };
}

/** Unique insert is the delivery claim. An ambiguous send stays claimed, never blindly retried. */
async function claim(key: string, config: ReturnType<typeof settings>): Promise<boolean> {
  const response = await fetch(`${config.url}/rest/v1/data_health_notifications?on_conflict=event_key`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Profile": "ops",
      Prefer: "resolution=ignore-duplicates,return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_key: key, outcome: "claimed" }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HALO Data Health ledger claim failed: HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("HALO Data Health ledger returned an invalid claim");
  return rows.length > 0;
}

async function record(key: string, outcome: string, config: ReturnType<typeof settings>) {
  const response = await fetch(`${config.url}/rest/v1/data_health_notifications?event_key=eq.${key}`, {
    method: "PATCH",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Profile": "ops",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ outcome, updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HALO Data Health ledger update failed: HTTP ${response.status}`);
}

async function send(message: string, config: ReturnType<typeof settings>): Promise<string> {
  const response = await fetch(config.sender, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.listenerToken}` },
    body: JSON.stringify({ chatId: config.group, clientId: config.clientId, instanceName: config.instanceName, message }),
    signal: AbortSignal.timeout(5_000),
  });
  const raw: unknown = await response.json().catch(() => null);
  const outer = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const body = outer.data && typeof outer.data === "object" ? outer.data as Record<string, unknown> : outer;
  const results = Array.isArray(body.results) ? body.results : [];
  const result = results[0] as Record<string, unknown> | undefined;
  if (!response.ok || body.success !== true || results.length !== 1 || result?.chatId !== config.group || result.success !== true) {
    throw new Error(`HALO Data Health listener did not confirm recipient: HTTP ${response.status}`);
  }
  if (result.queued === true && result.code === "QUEUED" && String(result.queueId ?? "").trim()) return "queued";
  if (result.queued !== true && typeof result.messageId === "string" && result.messageId && Number(result.ack) >= 1) return "sent";
  throw new Error("HALO Data Health listener response was unconfirmed");
}

/** POST /api/data-health/notify: authenticated scheduled evaluation and internal delivery. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const config = settings();
    const [health, strips, faults, notices] = await Promise.all([
      listEstateHealth(), listProjectStrips(), listProjectFaults(), listServiceNotices(),
    ]);
    const alerts = healthAlerts({ now: new Date(), health, strips, faults, notices });
    let delivered = 0;
    let duplicates = 0;
    for (const alert of alerts) {
      if (delivered >= 4) break; // Stay within Amplify's request duration.
      if (!await claim(alert.key, config)) { duplicates++; continue; }
      try {
        const outcome = await send(alert.message, config);
        await record(alert.key, outcome, config);
        delivered++;
      } catch (error) {
        await record(alert.key, "unconfirmed", config);
        throw error;
      }
    }
    return NextResponse.json({ success: true, evaluated: alerts.length, delivered, duplicates });
  } catch (error) {
    console.error("[ERROR][halo-data-health] notification failed", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown failure" }, { status: 500 });
  }
}
