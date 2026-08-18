const PUBLIC_PATHS = new Set(["/login", "/unauthorized"]);
const PUBLIC_PREFIXES = ["/auth/"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function isWriteRequest(method: string) {
  return WRITE_METHODS.has(method.toUpperCase());
}
