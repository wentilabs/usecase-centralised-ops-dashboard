import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import {
  LOCAL_AUTH_BYPASS_DISABLED_COOKIE,
  canAccessDashboard,
  canEditConfigs,
  shouldBypassLocalAuth,
} from "@/lib/auth-policy";
import { getSupabaseAuthConfig } from "./auth-config";

export type DashboardSession = {
  email: string | null;
  allowed: boolean;
  canEdit: boolean;
  isLocalBypass: boolean;
  configured: boolean;
  /** Recorded against every config change in ops.config_audit. */
  actor: string;
};

function hostnameFromHost(requestHost?: string) {
  const firstHost = requestHost?.split(",", 1)[0]?.trim();
  if (!firstHost) return "";
  try {
    return new URL(`http://${firstHost}`).hostname;
  } catch {
    return "";
  }
}

/** Server-side identity for pages and route handlers. Fails closed. */
export async function getDashboardSession(): Promise<DashboardSession> {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? undefined;

  const isLocalBypass = shouldBypassLocalAuth({
    nodeEnv: process.env.NODE_ENV,
    hostname: hostnameFromHost(requestHost),
    requestHost,
    bypassSetting: process.env.LOCAL_AUTH_BYPASS,
    bypassDisabled: cookieStore.get(LOCAL_AUTH_BYPASS_DISABLED_COOKIE)?.value === "1",
  });

  const config = getSupabaseAuthConfig();
  let email: string | null = null;
  let authError = false;

  if (!isLocalBypass && config) {
    try {
      const supabase = createServerClient(config.url, config.publishableKey, {
        cookies: {
          getAll: () => cookieStore.getAll(),
          // Route handlers and pages may not mutate cookies here; the
          // middleware owns session refresh.
          setAll: () => {},
        },
      });
      const { data, error } = await supabase.auth.getClaims();
      email = typeof data?.claims?.email === "string" ? data.claims.email : null;
      authError = Boolean(error);
    } catch {
      authError = true;
    }
  }

  const allowed = canAccessDashboard({
    isLocalBypass,
    configured: Boolean(config),
    email,
    authError,
  });

  return {
    email,
    allowed,
    canEdit: allowed && (isLocalBypass || canEditConfigs(email)),
    isLocalBypass,
    configured: Boolean(config),
    actor: email ?? (isLocalBypass ? "local-bypass" : "unknown"),
  };
}
