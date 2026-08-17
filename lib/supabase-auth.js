"use strict";

/**
 * Supabase Auth (email OTP) against the company's dedicated auth project,
 * spoken over the REST API so the dashboard keeps its zero-dependency footprint.
 *
 * House-pattern notes:
 *  - Claims are verified server-side on every request (GET /auth/v1/user),
 *    never trusted from the client.
 *  - Every call has an application-owned timeout (SEC-002/003 in the penta
 *    ocean review were exactly this gap).
 *  - The allow-list is checked BEFORE an OTP is sent and create_user is false,
 *    so an unapproved address can neither receive a code nor create an auth
 *    user (SEC-001 in that review).
 */

const AUTH_TIMEOUT_MS = 8000;
// Verified identities are cached briefly so a page full of requests doesn't
// mean a page full of round trips. Short enough that a revoked session stops
// working promptly.
const VERIFY_CACHE_TTL_MS = 60_000;

const verifyCache = new Map(); // access_token → { email, expiresAt }

function authConfig(env = process.env) {
  const url = String(env.AUTH_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.AUTH_SUPABASE_PUBLISHABLE_KEY || "";
  return { url, key, configured: Boolean(url && key) };
}

async function authFetch(path, { method = "GET", body = null, token = null, env = process.env } = {}) {
  const { url, key, configured } = authConfig(env);
  if (!configured) throw new Error("auth_not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: key,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

// Send a 6-digit code. Callers MUST have checked the allow-list first.
async function requestOtp(email, env = process.env) {
  const res = await authFetch("/auth/v1/otp", {
    method: "POST",
    body: { email, create_user: false },
    env,
  });
  if (!res.ok) {
    const reason = res.json?.error_description || res.json?.msg || res.text?.slice(0, 200) || res.status;
    throw new Error(`otp_request_failed: ${reason}`);
  }
  return true;
}

// Exchange the emailed code for a session.
async function verifyOtp(email, token, env = process.env) {
  const res = await authFetch("/auth/v1/verify", {
    method: "POST",
    body: { type: "email", email, token },
    env,
  });
  if (!res.ok || !res.json?.access_token) {
    const reason = res.json?.error_description || res.json?.msg || res.status;
    throw new Error(`otp_verify_failed: ${reason}`);
  }
  return {
    accessToken: res.json.access_token,
    refreshToken: res.json.refresh_token || null,
    expiresIn: Number(res.json.expires_in) || 3600,
    email: res.json.user?.email || email,
  };
}

// Server-side claim verification. Returns { email, authError }: authError=true
// means "couldn't establish identity", which callers must treat as a denial.
async function verifyAccessToken(accessToken, { env = process.env, now = Date.now() } = {}) {
  if (!accessToken) return { email: null, authError: false };

  const cached = verifyCache.get(accessToken);
  if (cached && cached.expiresAt > now) return { email: cached.email, authError: false };

  let res;
  try {
    res = await authFetch("/auth/v1/user", { token: accessToken, env });
  } catch (error) {
    if (error.message === "auth_not_configured") return { email: null, authError: false, configured: false };
    return { email: null, authError: true };
  }

  if (res.status === 401 || res.status === 403) {
    verifyCache.delete(accessToken);
    return { email: null, authError: false }; // definitively signed out
  }
  if (!res.ok || !res.json?.email) return { email: null, authError: true };

  verifyCache.set(accessToken, { email: res.json.email, expiresAt: now + VERIFY_CACHE_TTL_MS });
  return { email: res.json.email, authError: false };
}

function forgetToken(accessToken) {
  if (accessToken) verifyCache.delete(accessToken);
}

module.exports = {
  AUTH_TIMEOUT_MS,
  VERIFY_CACHE_TTL_MS,
  authConfig,
  requestOtp,
  verifyOtp,
  verifyAccessToken,
  forgetToken,
};
