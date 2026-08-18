/**
 * Authentication / authorization policy — pure functions only.
 *
 * Every decision takes its inputs explicitly rather than reading process.env
 * inline, so the rules are unit-testable, and production fails closed when
 * auth is unconfigured or unreachable.
 */

type LocalAuthBypassInput = {
  nodeEnv?: string;
  hostname: string;
  requestHost?: string;
  bypassSetting?: string;
  bypassDisabled?: boolean;
};

type DashboardAccessInput = {
  isLocalBypass: boolean;
  configured: boolean;
  email: string | null;
  authError?: boolean;
  emailList?: string;
  domainList?: string;
};

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Control characters are rejected in redirect targets.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export const LOCAL_AUTH_BYPASS_DISABLED_COOKIE = "ops-local-auth-bypass-disabled";

function parseList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(email?: string | null) {
  const normalized = email?.trim().toLowerCase() ?? "";
  return /^[^@\s]+@[^@\s]+$/.test(normalized) ? normalized : null;
}

export function getSafeRedirect(value?: string | null, fallback = "/") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARS.test(value)
  ) {
    return fallback;
  }

  const base = new URL("https://ops.local");
  const candidate = new URL(value, base);
  if (candidate.origin !== base.origin) return fallback;

  return `${candidate.pathname}${candidate.search}${candidate.hash}`;
}

/** May this address sign in at all? */
export function isEmailWhitelisted(
  email: string | null | undefined,
  emailList = process.env.WHITELIST_EMAILS,
  domainList = process.env.WHITELIST_DOMAINS,
) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return parseList(emailList).includes(normalized) || parseList(domainList).includes(domain);
}

/** May this address CHANGE configs? Empty list = every signed-in user may. */
export function canEditConfigs(
  email: string | null | undefined,
  editorList = process.env.EDITOR_EMAILS,
) {
  const editors = parseList(editorList);
  if (!editors.length) return true;
  const normalized = normalizeEmail(email);
  return normalized !== null && editors.includes(normalized);
}

/** Local convenience, deliberately hard to enable by accident. */
export function shouldBypassLocalAuth({
  nodeEnv,
  hostname,
  requestHost,
  bypassSetting,
  bypassDisabled,
}: LocalAuthBypassInput) {
  if (bypassDisabled || nodeEnv === "production" || bypassSetting?.trim().toLowerCase() === "false") {
    return false;
  }

  const parsedHostname = hostname.trim().toLowerCase();
  if (!LOOPBACK_HOSTNAMES.has(parsedHostname)) return false;
  if (!requestHost) return true;

  try {
    const firstHost = requestHost.split(",", 1)[0]?.trim();
    if (!firstHost) return false;
    const headerHostname = new URL(`http://${firstHost}`).hostname.toLowerCase();
    return LOOPBACK_HOSTNAMES.has(headerHostname);
  } catch {
    return false;
  }
}

/** The gate. Unconfigured or unreachable auth denies everyone. */
export function canAccessDashboard({
  isLocalBypass,
  configured,
  email,
  authError,
  emailList,
  domainList,
}: DashboardAccessInput) {
  if (isLocalBypass) return true;
  if (!configured || authError) return false;
  return isEmailWhitelisted(email, emailList, domainList);
}
