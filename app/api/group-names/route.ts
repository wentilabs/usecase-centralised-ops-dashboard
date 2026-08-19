import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getGroupNames } from "@/lib/group-names";
import { listConfigs } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICE_KEYS } from "@/lib/services";

export const dynamic = "force-dynamic";

// Every column across the five services that holds WhatsApp chat ids.
const CHAT_ID_COLUMNS = [
  "whatsapp_group_id",
  "wa_group_ids",
  "whatsapp_group_ids",
  "alert_whatsapp_gid",
  "poc_alert_wa_groups",
  "whatsapp_wbgt_source_chat_ids",
];

function collectChatIds(rows: Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const column of CHAT_ID_COLUMNS) {
      String(row[column] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.endsWith("@g.us"))
        .forEach((entry) => ids.add(entry));
    }
  }
  return [...ids];
}

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));
  const rows = settled.flatMap((result) =>
    result.status === "fulfilled" ? (result.value as Record<string, unknown>[]) : [],
  );

  const names = await getGroupNames(collectChatIds(rows), { refresh });
  return NextResponse.json(names, { headers: { "Cache-Control": "private, no-store" } });
}
