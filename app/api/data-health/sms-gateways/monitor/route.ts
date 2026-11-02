import { NextRequest, NextResponse } from "next/server";
import { healthNotificationAuthorized, healthNotificationSettings, sendHealthNotification } from "@/lib/health-notification-transport";
import { monitorSmsGateways } from "@/lib/sms-gateway-health";
import { evaluateSmsGateways, claimSmsGatewayNotification, recordSmsGatewayNotification } from "@/lib/sms-gateway-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/data-health/sms-gateways/monitor — monitorSmsGatewayHealth in lib/openapi.ts.
 * One-minute external schedule. Uses HALO's existing internal sender and token.
 */
export async function POST(request: NextRequest) {
  if (!healthNotificationAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const opened = await evaluateSmsGateways();
    // Validate before claiming anything so missing sender settings cannot lose an alert.
    const settings = healthNotificationSettings();
    const result = await monitorSmsGateways({
      evaluate: async () => opened, claim: claimSmsGatewayNotification,
      record: recordSmsGatewayNotification, send: (message) => sendHealthNotification(message, settings),
    });
    if (result.failed) console.error("[ERROR][sms-gateway-monitor] notification_unconfirmed");
    return NextResponse.json({ success: result.failed === 0, ...result }, { status: result.failed ? 503 : 200 });
  } catch {
    console.error("[ERROR][sms-gateway-monitor] evaluation_or_delivery_failed");
    return NextResponse.json({ error: "SMS gateway monitoring unavailable" }, { status: 503 });
  }
}
