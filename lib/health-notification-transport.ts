import { timingSafeEqual } from "node:crypto";

export function healthNotificationAuthorized(request: { headers: Headers }): boolean {
  const expected = process.env.HALO_DATA_HEALTH_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (expected.length < 32 || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}


export function healthNotificationSettings() {
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


export async function sendHealthNotification(message: string, config: ReturnType<typeof healthNotificationSettings>): Promise<string> {
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
