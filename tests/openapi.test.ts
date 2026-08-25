import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openapiDocument } from "../lib/openapi";
import { SERVICE_KEYS } from "../lib/services";

/**
 * A spec that describes endpoints which do not exist, or omits ones that do, is
 * worse than no spec: an agent acts on it. These tests are what stop this
 * document becoming fiction.
 */

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;

type Operation = { operationId?: string; summary?: string; description?: string; responses?: Record<string, unknown> };

function operations(): { path: string; method: string; op: Operation }[] {
  const out: { path: string; method: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(openapiDocument.paths as Record<string, Record<string, unknown>>)) {
    for (const method of HTTP_METHODS) {
      if (item[method]) out.push({ path, method, op: item[method] as Operation });
    }
  }
  return out;
}

/** Route handler files, as URL paths with Next's [param] turned into {param}. */
async function handlerPaths(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(next, `${prefix}/${entry.name.replace(/^\[(?:\.\.\.)?(.+)\]$/, "{$1}")}`);
      } else if (entry.name === "route.ts") {
        const source = await readFile(next, "utf8");
        const methods = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map((m) =>
          m[1].toLowerCase(),
        );
        found.set(prefix, methods);
      }
    }
  }
  await walk(resolve("app/api"), "/api");
  return found;
}

test("every route handler is described, and every operation has a handler", async () => {
  const handlers = await handlerPaths();
  const described = new Set(operations().map((entry) => `${entry.method} ${entry.path}`));

  const missing: string[] = [];
  for (const [path, methods] of handlers) {
    for (const method of methods) {
      if (!described.has(`${method} ${path}`)) missing.push(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(missing, [], `route handlers with no OpenAPI operation: ${missing.join(", ")}`);

  const invented: string[] = [];
  for (const { path, method } of operations()) {
    const methods = handlers.get(path);
    if (!methods?.includes(method)) invented.push(`${method.toUpperCase()} ${path}`);
  }
  assert.deepEqual(invented, [], `operations with no route handler: ${invented.join(", ")}`);
});

test("every operation carries what an agent turns into a tool", () => {
  const ids = new Set<string>();
  for (const { path, method, op } of operations()) {
    const where = `${method.toUpperCase()} ${path}`;
    // operationId becomes the tool name in most agent frameworks.
    assert.ok(op.operationId, `${where} needs an operationId`);
    assert.match(op.operationId!, /^[a-z][A-Za-z0-9]+$/, `${where}: operationId should be lowerCamelCase`);
    assert.equal(ids.has(op.operationId!), false, `${where}: duplicate operationId ${op.operationId}`);
    ids.add(op.operationId!);

    assert.ok(op.summary && op.summary.length > 8, `${where} needs a summary`);
    // The description is the agent's entire understanding of what calling does.
    assert.ok(op.description && op.description.length > 60, `${where} needs a real description`);
    assert.ok(op.responses?.["200"], `${where} needs a 200`);
    assert.ok(op.responses?.["401"], `${where} must document 401 — everything is authenticated`);
  }
});

test("operations that change the world say so in their description", () => {
  // An agent reading "updates a row" and an agent reading "changes production
  // behaviour on the next cron tick" behave differently.
  const mutating = operations().filter(({ method }) => method !== "get");
  assert.ok(mutating.length >= 4, "expected several write operations");

  for (const { path, method, op } of mutating) {
    if (path.includes("reload") || path.includes("exports")) continue; // genuinely side-effect free
    const text = String(op.description);
    assert.match(
      text,
      /production|real-world|real WhatsApp|changes|disabled|effects/i,
      `${method.toUpperCase()} ${path} must state its consequence`,
    );
  }
});

test("the document declares bearer auth, and applies it globally", () => {
  const schemes = openapiDocument.components.securitySchemes as unknown as Record<
    string,
    { type: string; scheme?: string; description?: string }
  >;
  assert.equal(schemes.bearerAuth.type, "http");
  assert.equal(schemes.bearerAuth.scheme, "bearer");
  assert.deepEqual(openapiDocument.security, [{ bearerAuth: [] }]);
  // Scopes are the whole point of per-agent tokens; the scheme must explain them.
  const described = String(schemes.bearerAuth.description);
  for (const scope of ["read", "write", "jobs"]) assert.ok(described.includes(scope), `scheme should mention ${scope}`);
  assert.match(described, /not.{0,3} hierarchical/i, "the non-hierarchy is the surprising part");
});

test("it is OpenAPI 3.1, which is the version whose schemas are JSON Schema", () => {
  assert.equal(openapiDocument.openapi, "3.1.0");
  assert.ok(openapiDocument.info.version);
  assert.ok(openapiDocument.servers.length >= 1);
});

test("service and job enums come from the code, not a copy", () => {
  const params = (openapiDocument.paths["/api/config/{service}/{rowId}"].patch.parameters ?? []) as unknown as {
    name: string;
    schema: { enum?: string[] };
  }[];
  const service = params.find((p) => p.name === "service");
  assert.deepEqual(service?.schema.enum, [...SERVICE_KEYS]);
});

test("the committed openapi.yaml matches lib/openapi.ts", async () => {
  // The served endpoints render the object directly, so a stale committed file
  // would only mislead someone reading the repo — which is most readers.
  const { stringify } = await import("yaml");
  const expected = stringify(openapiDocument, { lineWidth: 0 });
  const onDisk = await readFile(resolve("openapi.yaml"), "utf8");
  assert.match(onDisk, /^# GENERATED from lib\/openapi\.ts/, "the file must say it is generated");
  assert.equal(
    onDisk.slice(onDisk.indexOf("\n") + 1),
    expected,
    "openapi.yaml is stale — run `npm run openapi`",
  );
});

test("no server URL is invented", () => {
  // The deployed hostname is not recorded in this repo, so it comes from
  // HALO_PUBLIC_URL or is omitted. A plausible-looking guess in a contract an
  // agent resolves is worse than no entry at all.
  const servers = openapiDocument.servers as readonly { url: string }[];
  assert.ok(servers.some((s) => s.url.startsWith("http://localhost")), "localhost must always be listed");
  for (const server of servers) {
    if (server.url.startsWith("http://localhost")) continue;
    assert.equal(
      server.url,
      (process.env.HALO_PUBLIC_URL ?? "").replace(/\/+$/, ""),
      "a non-localhost server must come from HALO_PUBLIC_URL",
    );
  }
});
