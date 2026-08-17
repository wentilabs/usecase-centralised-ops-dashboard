"use strict";

/**
 * Authentication / authorization policy — pure functions only.
 *
 * Mirrors the house pattern used by wenti-penta-ocean-safety-fe and
 * wenti-wohhup-fe: every decision takes its inputs explicitly (no inline
 * process.env reads) so the rules are unit-testable, and production fails
 * closed when auth is unconfigured or unreachable.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// A browser can clear the local bypass for a session by setting this cookie,
// which is useful for exercising the real login flow on a dev machine.
const LOCAL_AUTH_BYPASS_DISABLED_COOKIE = "ops-local-auth-bypass-disabled";

function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(normalized) ? normalized : null;
}

// Allowed onto the dashboard at all: an exact email match, or a whole domain.
function isEmailWhitelisted(email, emailList, domainList) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return parseList(emailList).includes(normalized) || parseList(domainList).includes(domain);
}

// Allowed to WRITE. An empty editor list means "anyone who may sign in may
// edit"; set EDITOR_EMAILS to make everyone else read-only.
function canEditConfigs(email, editorList) {
  const editors = parseList(editorList);
  if (!editors.length) return true;
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && editors.includes(normalized);
}

// Local development convenience, deliberately hard to enable by accident:
// never in production, loopback hostnames only, and killable by cookie.
function shouldBypassLocalAuth({ nodeEnv, hostname, requestHost, bypassSetting, bypassDisabled } = {}) {
  if (bypassDisabled) return false;
  if (nodeEnv === "production") return false;
  if (String(bypassSetting ?? "").trim().toLowerCase() === "false") return false;

  const parsedHostname = String(hostname ?? "").trim().toLowerCase();
  if (!LOOPBACK_HOSTNAMES.has(parsedHostname)) return false;
  if (!requestHost) return true;

  // Host header may be a comma-separated proxy chain; the first hop decides.
  const firstHost = String(requestHost).split(",", 1)[0]?.trim();
  if (!firstHost) return false;
  try {
    const headerHostname = new URL(`http://${firstHost}`).hostname.toLowerCase();
    return LOOPBACK_HOSTNAMES.has(headerHostname);
  } catch {
    return false;
  }
}

// The single gate. `configured` is false when the auth project env vars are
// missing, `authError` when Supabase could not be reached — both deny.
function canAccessDashboard({ isLocalBypass, configured, email, authError, emailList, domainList } = {}) {
  if (isLocalBypass) return true;
  if (!configured || authError) return false;
  return isEmailWhitelisted(email, emailList, domainList);
}

// Only same-origin paths may be used as a post-login redirect.
function getSafeRedirect(value, fallback = "/") {
  const raw = String(value ?? "");
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(raw)
  ) {
    return fallback;
  }
  const base = new URL("https://ops.local");
  const candidate = new URL(raw, base);
  if (candidate.origin !== base.origin) return fallback;
  return `${candidate.pathname}${candidate.search}${candidate.hash}`;
}

module.exports = {
  LOCAL_AUTH_BYPASS_DISABLED_COOKIE,
  LOOPBACK_HOSTNAMES,
  isEmailWhitelisted,
  canEditConfigs,
  shouldBypassLocalAuth,
  canAccessDashboard,
  getSafeRedirect,
};
