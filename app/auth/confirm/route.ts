import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { getSafeRedirect } from "@/lib/auth-policy";
import { getSupabaseAuthConfig } from "@/lib/supabase/auth-config";

/**
 * Magic-link landing route.
 *
 * Supabase's email carries both a 6-digit code and a link. If the operator (or
 * their mail client) opens the link, the one-time token is consumed — without
 * this route that would dead-end, and the code they then type would be
 * rejected as invalid. Here the link completes the sign-in instead.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const redirectTo = getSafeRedirect(params.get("next") ?? params.get("redirect"));

  const failure = new URL("/login", request.url);
  failure.searchParams.set("reason", "session_expired");

  const config = getSupabaseAuthConfig();
  if (!config || !tokenHash || !type) return NextResponse.redirect(failure);

  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  response.headers.set("Cache-Control", "private, no-store");

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

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(failure);

  return response;
}
