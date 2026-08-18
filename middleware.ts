import { type NextRequest, NextResponse } from "next/server";

import {
  LOCAL_AUTH_BYPASS_DISABLED_COOKIE,
  isEmailWhitelisted,
  shouldBypassLocalAuth,
} from "@/lib/auth-policy";
import { isPublicPath } from "@/lib/route-policy";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

function copyAuthState(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  for (const header of ["cache-control", "pragma", "expires"]) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
  target.headers.set("Cache-Control", "private, no-store");
  return target;
}

function clearSupabaseCookies(request: NextRequest, response: NextResponse) {
  request.cookies.getAll().forEach((cookie) => {
    if (!cookie.name.startsWith("sb-")) return;
    response.cookies.set(cookie.name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: cookie.name.endsWith("-code-verifier"),
      sameSite: "lax",
    });
  });
  return response;
}

function loginRedirect(
  request: NextRequest,
  authResponse: NextResponse,
  reason?: "session_expired" | "unauthorized",
) {
  // API callers get a body they can read; browsers get bounced to the form.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return copyAuthState(authResponse, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (reason) loginUrl.searchParams.set("reason", reason);

  const response = copyAuthState(authResponse, NextResponse.redirect(loginUrl));
  return reason ? clearSupabaseCookies(request, response) : response;
}

export async function middleware(request: NextRequest) {
  const { hostname, pathname } = request.nextUrl;

  if (
    shouldBypassLocalAuth({
      nodeEnv: process.env.NODE_ENV,
      hostname,
      requestHost:
        request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? undefined,
      bypassSetting: process.env.LOCAL_AUTH_BYPASS,
      bypassDisabled: request.cookies.get(LOCAL_AUTH_BYPASS_DISABLED_COOKIE)?.value === "1",
    })
  ) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  if (pathname.startsWith("/auth/")) return NextResponse.next();

  const auth = await updateSupabaseSession(request);
  const isPublic = isPublicPath(pathname);

  if (auth.email && isEmailWhitelisted(auth.email)) {
    if (pathname === "/login") {
      return copyAuthState(auth.response, NextResponse.redirect(new URL("/", request.url)));
    }
    return auth.response;
  }

  if (isPublic) return auth.response;

  // Signed in but not approved: say so rather than looping the login form.
  if (auth.email) return loginRedirect(request, auth.response, "unauthorized");

  return loginRedirect(request, auth.response, auth.configured && auth.error ? "session_expired" : undefined);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
