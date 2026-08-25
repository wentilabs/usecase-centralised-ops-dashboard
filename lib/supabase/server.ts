import "server-only";

import { createServerClient } from "@supabase/ssr";

import { bearerFrom, permits, type Scope } from "../api-tokens";
import { resolveApiToken } from "../config-repository";
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
  /**
   * How this caller proved who they are. `token` is an agent holding a bearer
   * credential; `session` is a signed-in browser; `local-bypass` is loopback dev.
   */
  kind: "session" | "token" | "local-bypass" | "none";
  /** Present only for a token. A session has no scope list — see canEdit. */
  scopes: Scope[];
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

  // A bearer token short-circuits the cookie path entirely. Checked first so an
  // agent never depends on cookie state, and so the loopback bypass cannot
  // silently grant an unauthenticated request the powers of a real token.
  const bearer = bearerFrom(requestHeaders.get("authorization"));
  if (bearer) {
    const identity = await resolveApiToken(bearer);
    if (!identity) {
      return {
        email: null,
        allowed: false,
        canEdit: false,
        isLocalBypass: false,
        configured: true,
        actor: "unknown-token",
        kind: "none",
        scopes: [],
      };
    }
    return {
      email: null,
      allowed: permits(identity.scopes, "read") || identity.scopes.length > 0,
      // Scopes are additive and not hierarchical: `write` is required to change
      // anything, and holding `read` alone never confers it.
      canEdit: permits(identity.scopes, "write"),
      isLocalBypass: false,
      configured: true,
      actor: identity.actor,
      kind: "token",
      scopes: identity.scopes,
    };
  }

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
    kind: isLocalBypass ? "local-bypass" : allowed ? "session" : "none",
    // A browser session is governed by the allow-lists, not by scopes. Reporting
    // the equivalent set keeps a route's scope check uniform across both paths.
    scopes: allowed
      ? ((isLocalBypass || canEditConfigs(email)) ? (["read", "write", "jobs"] as Scope[]) : (["read"] as Scope[]))
      : [],
  };
}
