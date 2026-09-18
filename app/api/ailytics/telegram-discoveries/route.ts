import { NextResponse } from "next/server";

import { normalizeTelegramGroupDiscoveries } from "@/lib/ailytics-discovery";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" };

/**
 * `GET /api/ailytics/telegram-discoveries` — `listAilyticsTelegramDiscoveries`.
 * HALO's authenticated, server-only proxy to the Ailytics discovery inbox.
 * Browser code never sees LAMBDA_AUTH_TLK_KEY and cannot call the Lambda with
 * the shared outbound-message credential directly.
 */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });

  const endpoint = process.env.AILYTICS_DISCOVERY_URL?.trim();
  const rawKey = process.env.LAMBDA_AUTH_TLK_KEY?.trim().replace(/^Bearer\s+/i, "");
  if (!endpoint || !rawKey) {
    return NextResponse.json(
      { error: "Telegram group discovery is not configured on this HALO deployment." },
      { status: 503, headers: privateHeaders },
    );
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Telegram group discovery is temporarily unavailable." },
      { status: 502, headers: privateHeaders },
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      { error: response.status === 401 || response.status === 403 ? "HALO cannot authenticate to Telegram group discovery." : "Telegram group discovery is temporarily unavailable." },
      { status: 502, headers: privateHeaders },
    );
  }

  return NextResponse.json(
    { discoveries: normalizeTelegramGroupDiscoveries(body), fetchedAt: new Date().toISOString() },
    { headers: privateHeaders },
  );
}
