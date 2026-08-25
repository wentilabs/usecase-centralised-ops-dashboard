import { openapiDocument } from "./openapi";

/**
 * The MCP surface, derived from the OpenAPI document rather than hand-listed.
 *
 * This is the reason `lib/openapi.ts` is 3.1 rather than 3.0: in 3.1 the schema
 * objects *are* JSON Schema 2020-12, which is exactly what an MCP tool's
 * `inputSchema` must be. The conversion is therefore mechanical, and there is
 * one description of the API rather than two that drift.
 *
 * Everything here is pure — no I/O, no request handling — so the tool shapes,
 * the safety annotations and the URL building are all testable without a server.
 * `app/api/mcp/route.ts` does the JSON-RPC and the dispatch.
 */

export type JsonSchema = Record<string, unknown>;

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    /** No side effects. Clients may call these freely. */
    readOnlyHint: boolean;
    /** May change or remove something a person cares about. */
    destructiveHint: boolean;
    /** Calling twice with the same arguments is the same as calling once. */
    idempotentHint: boolean;
    /** Touches systems beyond this service — Google Sheets, WhatsApp, CloudLynx. */
    openWorldHint: boolean;
  };
};

/** How to turn a tool call back into an HTTP request against HALO's own API. */
export type CallPlan = {
  method: string;
  /** Path with `{param}` already substituted. */
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
};

type Parameter = { name: string; in: string; required?: boolean; schema?: JsonSchema; description?: string };

type Operation = {
  operationId: string;
  summary: string;
  description: string;
  tags?: readonly string[];
  parameters?: readonly Parameter[];
  requestBody?: { required?: boolean; content: Record<string, { schema: JsonSchema }> };
};

function operationsOf(): { path: string; method: string; op: Operation }[] {
  const out: { path: string; method: string; op: Operation }[] = [];
  const paths = openapiDocument.paths as unknown as Record<string, Record<string, Operation>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (op && typeof op === "object" && "operationId" in op) out.push({ path, method, op });
    }
  }
  return out;
}

/**
 * Safety annotations, derived rather than declared.
 *
 * MCP clients surface these to a user before calling, and some gate on them, so
 * they carry real weight. Deriving them from the operation means a new endpoint
 * cannot be added without one — the alternative is a hand-kept list that
 * silently omits the dangerous case.
 *
 * The interesting judgements:
 *
 *  - `runJob` is the only openly destructive tool. It can make a service send
 *    WhatsApp messages to a live construction site, and `wbgt-scrape` drives a
 *    real browser session. Not idempotent, because a second call sends again.
 *  - `updateProjectConfig` changes production behaviour but is idempotent — the
 *    same PATCH twice leaves the same row. It is *not* marked destructive,
 *    because it overwrites a value rather than destroying a record; the
 *    description carries the weight there.
 *  - `runExport` and `geocodeAddress` reach outside this service but only read.
 */
export function annotationsFor(path: string, method: string, op: Operation): McpTool["annotations"] {
  const readOnly = method === "get";
  const isJob = op.operationId === "runJob";
  const touchesOutside =
    isJob ||
    op.operationId === "runExport" ||
    op.operationId === "geocodeAddress" ||
    op.operationId === "createProject";

  return {
    readOnlyHint: readOnly,
    destructiveHint: isJob,
    // A GET is trivially idempotent; a job is not, because it acts each time.
    idempotentHint: readOnly || !isJob,
    openWorldHint: touchesOutside,
  };
}

/**
 * The JSON Schema for a tool's arguments: path and query parameters flattened
 * alongside the request body's own properties.
 *
 * Flattened on purpose. A model handles `{"service": "haze", "changes": {...}}`
 * far more reliably than `{"path": {"service": …}, "body": {"changes": …}}`, and
 * the names do not collide in this API. `toCallPlan` puts each value back where
 * it belongs.
 */
export function inputSchemaFor(op: Operation): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of op.parameters ?? []) {
    const schema = { ...(parameter.schema ?? { type: "string" }) };
    if (parameter.description) schema.description = parameter.description;
    properties[parameter.name] = schema;
    if (parameter.required) required.push(parameter.name);
  }

  const bodySchema = op.requestBody?.content?.["application/json"]?.schema as
    | { properties?: Record<string, unknown>; required?: readonly string[] }
    | undefined;
  if (bodySchema?.properties) {
    for (const [name, schema] of Object.entries(bodySchema.properties)) properties[name] = schema;
    for (const name of bodySchema.required ?? []) required.push(name);
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required: [...new Set(required)] } : {}),
    additionalProperties: false,
    $schema: "https://json-schema.org/draft/2020-12/schema",
  };
}

/** Every operation in the spec, as an MCP tool. */
export function mcpTools(): McpTool[] {
  return operationsOf()
    .map(({ path, method, op }) => ({
      name: op.operationId,
      title: op.summary,
      // Both, because a client may show only one and the summary alone is not
      // enough to call safely.
      description: `${op.summary}.\n\n${op.description}`,
      inputSchema: inputSchemaFor(op),
      annotations: annotationsFor(path, method, op),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Turn a tool call into the HTTP request that serves it.
 *
 * Arguments arrive flat; this routes each back to its place. Anything the
 * operation does not declare is dropped rather than forwarded — a model that
 * invents a field should not have it reach the database.
 */
export function toCallPlan(toolName: string, args: Record<string, unknown>): CallPlan | null {
  const entry = operationsOf().find(({ op }) => op.operationId === toolName);
  if (!entry) return null;
  const { path, method, op } = entry;

  let resolved = path;
  const query: Record<string, string> = {};

  for (const parameter of op.parameters ?? []) {
    const value = args[parameter.name];
    if (value === undefined || value === null) continue;
    if (parameter.in === "path") {
      resolved = resolved.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    } else if (parameter.in === "query") {
      query[parameter.name] = String(value);
    }
  }

  const bodySchema = op.requestBody?.content?.["application/json"]?.schema as
    | { properties?: Record<string, unknown> }
    | undefined;
  let body: Record<string, unknown> | null = null;
  if (bodySchema?.properties) {
    body = {};
    for (const name of Object.keys(bodySchema.properties)) {
      if (args[name] !== undefined) body[name] = args[name];
    }
  }

  return { method: method.toUpperCase(), path: resolved, query, body };
}

/** Arguments a tool declares as required but the call omitted. */
export function missingRequired(toolName: string, args: Record<string, unknown>): string[] {
  const tool = mcpTools().find((entry) => entry.name === toolName);
  if (!tool) return [];
  const required = (tool.inputSchema.required as string[] | undefined) ?? [];
  return required.filter((name) => args[name] === undefined || args[name] === null || args[name] === "");
}

/**
 * Protocol revisions this server understands, newest first.
 *
 * Version negotiation is `initialize`-time: echo the client's revision when it
 * is one of these, otherwise answer with the newest we support and let the
 * client decide whether to continue.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export function negotiateProtocol(requested: unknown): string {
  const asked = String(requested ?? "");
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST_PROTOCOL_VERSION;
}

export const SERVER_INFO = {
  name: "halo-centralised-services",
  title: "HALO — Centralised Services",
  version: openapiDocument.info.version,
} as const;

/** JSON-RPC 2.0 error codes, plus the ones MCP leans on. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
