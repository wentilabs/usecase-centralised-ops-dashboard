"use strict";

/**
 * Which paths are reachable without a session. Everything else requires an
 * authenticated, whitelisted operator.
 */

const PUBLIC_PATHS = new Set([
  "/login",
  "/login.html",
  "/styles.css",
  "/api/auth/request-otp",
  "/api/auth/verify-otp",
  "/api/auth/session",
  "/api/auth/sign-out",
  "/healthz",
]);

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

// API callers get a 401 body; browsers get bounced to the login page.
function isApiPath(pathname) {
  return String(pathname || "").startsWith("/api/");
}

// Requests that change configuration require edit rights, not just access.
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function isWriteRequest(method) {
  return WRITE_METHODS.has(String(method || "").toUpperCase());
}

module.exports = { PUBLIC_PATHS, isPublicPath, isApiPath, isWriteRequest };
