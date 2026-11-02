import { NextRequest, NextResponse } from "next/server";

import { listNotificationEstateHealth, listNotificationProcessWindow, listProjectFaults, listServiceNotices } from "@/lib/config-repository";
import { executeHealthNotification } from "@/lib/health-notification-flow";
import { parseHealthNotifyOptions } from "@/lib/health-notifications";

import { healthNotificationAuthorized as authorized, healthNotificationSettings as settings, sendHealthNotification as send } from "@/lib/health-notification-transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class BadRequestError extends Error {}

async function readNotifyOptions(request: NextRequest) {
  const text = await request.text();
  if (text.length > 1024) throw new BadRequestError("Request body is too large.");
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }
  try {
    return parseHealthNotifyOptions(value);
  } catch (error) {
    throw new BadRequestError(error instanceof Error ? error.message : "Invalid request body.");
  }
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

/** POST /api/data-health/notify: authenticated scheduled evaluation and internal delivery. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const options = await readNotifyOptions(request);
    let config: ReturnType<typeof settings> | null = null;
    const senderSettings = () => config ??= settings();
    const result = await executeHealthNotification(new Date(), options, {
      alreadyClaimed: (key) => alreadyClaimed(key, senderSettings()),
      claim: (key) => claim(key, senderSettings()),
      read: async (since) => {
        const [health, strips, faults, notices] = await Promise.all([
          listNotificationEstateHealth(), listNotificationProcessWindow(since), listProjectFaults(), listServiceNotices(),
        ]);
        return { health, strips, faults, notices };
      },
      send: (message) => send(message, senderSettings()),
      record: (key, outcome) => record(key, outcome, senderSettings()),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof BadRequestError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    console.error("[ERROR][halo-data-health] notification failed", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown failure" }, { status: 500 });
  }
}
