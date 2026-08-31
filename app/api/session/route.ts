import { NextResponse } from "next/server";

import { cachedFieldSpecCount } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/session` — `getSession` in the OpenAPI contract.
 *
 * Who the caller is and what they may do, plus booleans saying whether the server
 * can see its own allow-list and how many field specs are cached. Takes no
 * parameters.
 *
 * The only route that answers before the allow-list check, deliberately: it is
 * most useful to someone who has just been refused and is trying to find out
 * which side is blind. Values are never returned, only whether they are set.
 */

export async function GET() {
  const session = await getDashboardSession();
  return NextResponse.json(
    {
      ...session,
      // Booleans only — never the values themselves.
      allowlistConfigured: Boolean(process.env.WHITELIST_EMAILS || process.env.WHITELIST_DOMAINS),
      editorListConfigured: Boolean(process.env.EDITOR_EMAILS),
      listenerConfigured: Boolean(process.env.LISTENER_SUPABASE_URL && process.env.LISTENER_SUPABASE_ANON_KEY),
      // Whether group chips link out to Viso. The value itself is not a secret,
      // so report it — a wrong host is as diagnosable as a missing one.
      visoUrl: process.env.VISO_URL?.replace(/\/+$/, "") || null,
      // Non-zero after the dashboard has rendered once, which proves this route
      // and the page share one schema cache — i.e. that ⟳ Refresh really does
      // make a new Supabase column appear without a redeploy.
      cachedSpecs: cachedFieldSpecCount(),
      // Which build is actually serving — Amplify sets these during the build.
      build: {
        branch: process.env.AWS_BRANCH ?? null,
        commit: process.env.AWS_COMMIT_ID?.slice(0, 7) ?? null,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
