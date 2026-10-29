import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const KEYCHAIN_SERVICE = "HALO Daily Error Report";
const KEYCHAIN_ACCOUNT = "halo-daily-investigation";
const MAX_BYTES = 2_000_000;

function endpoint(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/data-health/copy-errors") {
    throw new Error("Invalid report endpoint");
  }
  return url;
}

try {
  const config = JSON.parse(await readFile(new URL("../docs/HALO_AUTOMATION_CONFIG.json", import.meta.url), "utf8"));
  if (!config.reportUrl) throw new Error("Not configured");
  const url = endpoint(config.reportUrl);
  // Fetch only this fixed Keychain item; never accept a token through arguments or environment.
  const token = execFileSync("/usr/bin/security", [
    "find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (token.length < 32) throw new Error("Missing credential");

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !/^text\/plain(?:;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body) {
    throw new Error("HALO retrieval failed");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Report too large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  process.stdout.write(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.stderr.write("HALO_REPORT_UNAVAILABLE: no report retrieved; check the configured endpoint and Keychain item.\n");
  process.exitCode = 1;
}
