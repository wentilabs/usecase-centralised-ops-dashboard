import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { EXPORTS, isExportKey } from "@/lib/jobs";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Copy → prune → export → delete on the service side; allow generous headroom. */
const TIMEOUT_MS = 90_000;

/**
 * Proxy for the alert services' xlsx export endpoints.
 *
 * Two modes:
 * - `?preflight=1` returns the service's read-only readiness report, so the
 *   dialog can say exactly which permission is still outstanding.
 * - otherwise the service returns base64 xlsx, which this route re-emits as a
 *   real file download so the browser never sees the service URL.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ export: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { export: key } = await context.params;
  if (!isExportKey(key)) return NextResponse.json({ error: `Unknown export ${key}` }, { status: 404 });
  const definition = EXPORTS[key];

  const base = (process.env[definition.baseUrlEnv] ?? "").replace(/\/+$/, "");
  if (!base) {
    return NextResponse.json(
      {
        ready: false,
        blockers: [
          {
            code: "base_url_missing",
            summary: `${definition.baseUrlEnv} is not set in HALO`,
            remedy: `Set ${definition.baseUrlEnv} to the deployed ${definition.service} service base URL, then redeploy.`,
          },
        ],
      },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const preflight = request.nextUrl.searchParams.get("preflight") === "1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${definition.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(preflight ? { preflight: true } : {}) }),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (!res.ok || !parsed) {
      return NextResponse.json(
        { error: parsed?.error ?? `Service returned ${res.status}`, raw: parsed ? undefined : text.slice(0, 1000) },
        { status: 502 },
      );
    }

    // Preflight, or an export the service declined: hand the report back as-is
    // so the dialog can render the blockers and their remedies verbatim.
    if (preflight || parsed.exported !== true) return NextResponse.json(parsed);

    const base64 = String(parsed.xlsx_base64 ?? "");
    if (!base64) return NextResponse.json({ error: "Service reported success but returned no file." }, { status: 502 });

    const bytes = Buffer.from(base64, "base64");
    const fileName = String(parsed.file_name ?? "export.xlsx").replace(/"/g, "");
    console.log(
      `[halo][export] ${definition.key} project=${String(body.projectCode ?? "")} bytes=${bytes.length} actor=${session.email ?? "local"}`,
    );

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? `The ${definition.service} service did not respond within ${TIMEOUT_MS / 1000}s.`
          : error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
