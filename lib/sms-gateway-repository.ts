import "server-only";
import type { SmsGatewayEvent, SmsGatewayHealth } from "./sms-gateway-health";

async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SMS gateway database is not configured");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method, cache: "no-store",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "lightning",
      "Content-Profile": "lightning", "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`SMS gateway database request failed: HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

export async function readSmsGatewayHealth(): Promise<SmsGatewayHealth[]> {
  const rows = await request("sms_gateway_health?select=*&order=gateway_id&limit=100");
  if (!Array.isArray(rows) || rows.length >= 100) throw new Error("SMS gateway health is incomplete");
  return rows as SmsGatewayHealth[];
}

export async function evaluateSmsGateways(): Promise<number> {
  const opened = await request("rpc/evaluate_sms_gateways", "POST", {});
  if (typeof opened !== "number") throw new Error("Invalid SMS gateway monitor response");
  return opened;
}

export async function claimSmsGatewayNotification(): Promise<SmsGatewayEvent | null> {
  const rows = await request("rpc/claim_sms_gateway_notification", "POST", {});
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid SMS gateway notification claim");
  return rows[0] as SmsGatewayEvent | undefined ?? null;
}

export async function recordSmsGatewayNotification(id: string, outcome: "sent" | "queued" | "unconfirmed") {
  await request(`sms_gateway_events?id=eq.${encodeURIComponent(id)}&notification_state=eq.claimed`, "PATCH", { notification_state: outcome });
}
