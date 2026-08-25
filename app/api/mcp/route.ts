import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  LATEST_PROTOCOL_VERSION,
  RPC,
  SERVER_INFO,
  mcpTools,
  missingRequired,
  negotiateProtocol,
  toCallPlan,
} from "@/lib/mcp";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * MCP over Streamable HTTP, stateless.
 *
 * Only the JSON response mode is implemented — no SSE, no session ids. That is a
 * permitted subset of the transport and the right one here: every operation is a
 * short request/response against an HTTP API, so there is nothing to stream and
 * no server-initiated message to deliver. A client that insists on SSE will
 * negotiate down to JSON.
 *
 * Tools are derived from the OpenAPI document (`lib/mcp.ts`), and a call is
 * dispatched by making the corresponding HTTP request against this same app with
 * the caller's own Authorization header. That indirection is deliberate: it means
 * MCP cannot acquire a capability the HTTP API does not already grant, and a
 * scope check written once in a route handler governs both surfaces.
 */

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };

const PROTOCOL_HEADER = "MCP-Protocol-Version";

function result(id: string | number | null, value: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result: value },
    { headers: { [PROTOCOL_HEADER]: LATEST_PROTOCOL_VERSION } },
  );
}

function failure(id: string | number | null, code: number, message: string, data?: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { headers: { [PROTOCOL_HEADER]: LATEST_PROTOCOL_VERSION } },
  );
}

/**
 * A tool result. `isError: true` reports a failed *call* while the JSON-RPC
 * request itself succeeded — the distinction MCP draws so a model can see and
 * reason about the failure rather than the client swallowing it.
 */
function toolResult(text: string, structured?: unknown, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(structured === undefined ? {} : { structuredContent: structured }),
    isError,
  };
}

export async function GET() {
  // No SSE stream to open. Say so plainly rather than hanging a client.
  return NextResponse.json(
    { error: "This MCP server is stateless and speaks JSON over POST only." },
    { status: 405, headers: { Allow: "POST", [PROTOCOL_HEADER]: LATEST_PROTOCOL_VERSION } },
  );
}

export async function POST(request: NextRequest) {
  let payload: RpcRequest;
  try {
    payload = (await request.json()) as RpcRequest;
  } catch {
    return failure(null, RPC.PARSE_ERROR, "Request body is not valid JSON.");
  }

  if (Array.isArray(payload)) {
    return failure(null, RPC.INVALID_REQUEST, "Batched requests are not supported.");
  }
  const id = payload.id ?? null;
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    return failure(id, RPC.INVALID_REQUEST, "Expected a JSON-RPC 2.0 request with a method.");
  }

  const params = (payload.params ?? {}) as Record<string, unknown>;

  switch (payload.method) {
    case "initialize":
      return result(id, {
        protocolVersion: negotiateProtocol(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: [
          "HALO is the configuration control surface for six centralised alerting services.",
          "",
          "Call getSession first to learn which scopes your credential carries, then getSchema to learn",
          "the column shape — it is introspected from the live database and is not fixed in this server.",
          "",
          "There is no staging environment. A write changes what a service does on its next cron tick,",
          "and runJob can make a service send WhatsApp messages to a live construction site. Prefer a",
          "project with enabled = false when trying something out.",
        ].join("\n"),
      });

    // Notifications carry no id and expect no reply body.
    case "notifications/initialized":
      return new Response(null, { status: 202, headers: { [PROTOCOL_HEADER]: LATEST_PROTOCOL_VERSION } });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: mcpTools() });

    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      const plan = toCallPlan(name, args);
      if (!plan) return failure(id, RPC.METHOD_NOT_FOUND, `No such tool: ${name}`);

      const missing = missingRequired(name, args);
      if (missing.length) {
        return failure(id, RPC.INVALID_PARAMS, `Missing required argument(s): ${missing.join(", ")}`);
      }

      // Authorization is not re-implemented here. The call is made against this
      // app's own HTTP API carrying the caller's credential, so the route's own
      // scope check decides — MCP can never exceed what the API already allows.
      const authorization = request.headers.get("authorization");
      const target = new URL(plan.path, request.nextUrl.origin);
      for (const [key, value] of Object.entries(plan.query)) target.searchParams.set(key, value);

      try {
        const response = await fetch(target, {
          method: plan.method,
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(authorization ? { authorization } : {}),
            // Forwarded so a cookie-authenticated client can drive MCP too.
            ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}),
          },
          ...(plan.body && plan.method !== "GET" ? { body: JSON.stringify(plan.body) } : {}),
        });

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          // Exports return a file. Describe it rather than inlining megabytes of
          // base64 into a model's context.
          const size = response.headers.get("content-length");
          return result(
            id,
            toolResult(
              `${name} returned a ${contentType || "binary"} response${size ? ` of ${size} bytes` : ""}. ` +
                `Binary results are not delivered over MCP — call ${plan.method} ${plan.path} directly to fetch it.`,
              { status: response.status, contentType, bytes: size ? Number(size) : null },
              !response.ok,
            ),
          );
        }

        const body = await response.json();
        return result(
          id,
          toolResult(JSON.stringify(body, null, 2), body, !response.ok),
        );
      } catch (error) {
        return result(
          id,
          toolResult(`${name} could not be reached: ${error instanceof Error ? error.message : String(error)}`, undefined, true),
        );
      }
    }

    // Declared unsupported rather than left to time out.
    case "resources/list":
      return result(id, { resources: [] });
    case "prompts/list":
      return result(id, { prompts: [] });

    default:
      return failure(id, RPC.METHOD_NOT_FOUND, `Unsupported method: ${payload.method}`);
  }
}

/** Unauthenticated discovery, matching /openapi.json — the shape is not secret. */
export async function OPTIONS() {
  const session = await getDashboardSession();
  return NextResponse.json({
    server: SERVER_INFO,
    protocolVersion: LATEST_PROTOCOL_VERSION,
    transport: "streamable-http (JSON only)",
    tools: mcpTools().length,
    authenticated: session.allowed,
  });
}
