import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabaseAuthConfig } from "./auth-config";

type SupabaseRequestAuth = {
  configured: boolean;
  email: string | null;
  error: boolean;
  response: NextResponse;
};

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

/** Refreshes the Supabase session cookie and reports the verified claim. */
export async function updateSupabaseSession(request: NextRequest): Promise<SupabaseRequestAuth> {
  const config = getSupabaseAuthConfig();
  let response = noStore(NextResponse.next({ request }));

  if (!config) {
    return { configured: false, email: null, error: false, response };
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        noStore(response);
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;

  return { configured: true, email, error: Boolean(error), response };
}
