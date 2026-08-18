import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { LOCAL_AUTH_BYPASS_DISABLED_COOKIE, shouldBypassLocalAuth } from "@/lib/auth-policy";
import { getSupabaseAuthConfig } from "@/lib/supabase/auth-config";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.headers.set("Cache-Control", "private, no-store");

  // On a loopback host there is no session to end, so signing out means
  // switching the bypass off for this browser — otherwise the click looks
  // like it did nothing.
  if (
    shouldBypassLocalAuth({
      nodeEnv: process.env.NODE_ENV,
      hostname: request.nextUrl.hostname,
      requestHost:
        request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? undefined,
      bypassSetting: process.env.LOCAL_AUTH_BYPASS,
    })
  ) {
    response.cookies.set(LOCAL_AUTH_BYPASS_DISABLED_COOKIE, "1", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }

  const config = getSupabaseAuthConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });

  await supabase.auth.signOut();
  return response;
}
