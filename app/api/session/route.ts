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
      listenerConfigured: Boolean(process.env.LISTENER_SUPABASE_URL && process.env.LISTENER_SUPABASE_ANON_KEY),
      // Which build is actually serving — Amplify sets these during the build.
      build: {
        branch: process.env.AWS_BRANCH ?? null,
        commit: process.env.AWS_COMMIT_ID?.slice(0, 7) ?? null,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
