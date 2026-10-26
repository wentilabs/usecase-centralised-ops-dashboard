import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { listNotificationEstateHealth, listNotificationProcessWindow, listProjectFaults, listServiceNotices } from "@/lib/config-repository";
import { dueHealthWindow, healthSummary, healthSummaryKey } from "@/lib/health-notifications";

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
async function alreadyClaimed(key: string, config: ReturnType<typeof settings>): Promise<boolean> {
  const response = await fetch(`${config.url}/rest/v1/data_health_notifications?select=event_key&event_key=eq.${key}&limit=1`, {
    cache: "no-store",
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Accept-Profile": "ops" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HALO Data Health ledger lookup failed: HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("HALO Data Health ledger returned an invalid lookup");
  return rows.length > 0;
}

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
    const window = dueHealthWindow(new Date());
    if (!window) return NextResponse.json({ success: true, due: false, delivered: 0 });
    const config = settings();
    if (await alreadyClaimed(healthSummaryKey(window.end), config)) {
      return NextResponse.json({ success: true, due: true, delivered: 0, duplicates: 1 });
    }
    const [health, strips, faults, notices] = await Promise.all([
      listNotificationEstateHealth(), listNotificationProcessWindow(window.start), listProjectFaults(), listServiceNotices(),
    ]);
    const summary = healthSummary({ windowStart: window.start, windowEnd: window.end, health, strips, faults, notices });
    if (!await claim(summary.key, config)) {
      return NextResponse.json({ success: true, due: true, evaluated: summary.issueCount, delivered: 0, duplicates: 1 });
    }
    try {
      const outcome = await send(summary.message, config);
      await record(summary.key, outcome, config);
    } catch (error) {
      await record(summary.key, "unconfirmed", config);
      throw error;
    }
    return NextResponse.json({ success: true, due: true, evaluated: summary.issueCount, delivered: 1, duplicates: 0 });
  } catch (error) {
    console.error("[ERROR][halo-data-health] notification failed", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown failure" }, { status: 500 });
  }
}
