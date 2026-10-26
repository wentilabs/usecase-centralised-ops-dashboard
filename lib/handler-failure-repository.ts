import "server-only";

import { handlerFailureRows, type HandlerFailureReport } from "./handler-failures";

export async function listHandlerFailures(): Promise<HandlerFailureReport> {
  const checkedAt = new Date().toISOString();
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) return { checkedAt, failures: [], unavailable: true };
  const since = new Date(Date.parse(checkedAt) - 48 * 60 * 60_000).toISOString();
  try {
    const response = await fetch(`${url}/rest/v1/service_handler_failures?select=service_key,route,reason,occurred_at&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=100`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "ops" },
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return { checkedAt, failures: handlerFailureRows(await response.json()), unavailable: false };
  } catch (error) {
    console.error("[HALO][handler-failures] read_failed", error instanceof Error ? error.message : "unknown");
    return { checkedAt, failures: [], unavailable: true };
  }
}
