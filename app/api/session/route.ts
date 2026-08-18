import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getDashboardSession();
  return NextResponse.json(
    {
      ...session,
      // Booleans only — never the values themselves.
      allowlistConfigured: Boolean(process.env.WHITELIST_EMAILS || process.env.WHITELIST_DOMAINS),
      editorListConfigured: Boolean(process.env.EDITOR_EMAILS),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
