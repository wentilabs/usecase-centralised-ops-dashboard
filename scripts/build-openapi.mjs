#!/usr/bin/env node
/**
 * Write the committed `openapi.yaml` from `lib/openapi.ts`.
 *
 * The served endpoints render the TypeScript object directly, so this file is
 * purely for reading on GitHub and for diffing an API change in review. A test
 * fails if it drifts from the source, so run this after editing the spec:
 *
 *   npm run openapi
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "halo-openapi-"));
try {
  execFileSync("npx", ["tsc", "lib/openapi.ts", "lib/services.ts", "lib/jobs.ts",
    "--outDir", out, "--module", "commonjs", "--target", "ES2022", "--skipLibCheck"], { stdio: "pipe" });
  const { openapiDocument } = await import(join(out, "openapi.js"));
  const { stringify } = await import("yaml");
  const body = stringify(openapiDocument, { lineWidth: 0 });
  const header = "# GENERATED from lib/openapi.ts — do not edit by hand. Run `npm run openapi`.\n";
  writeFileSync("openapi.yaml", header + body);
  console.log(`Wrote openapi.yaml (${body.split("\n").length} lines)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
