import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { JOBS, isJobKey, readSheetId, validateJobInput } from "@/lib/jobs";
import { listConfigs } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import type { ProjectConfigRow } from "@/lib/services";

export const dynamic = "force-dynamic";

/** These jobs write to Google Sheets and can walk a long date range. */
const TIMEOUT_MS = 60_000;

/**
 * Proxy for the alert services' sheet endpoints.
 *
 * HALO forwards rather than letting the browser call the Lambda directly: the
 * service URLs stay server-side, and triggering a job is gated on the same
 * editor permission that guards a config write.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ job: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) {
    return NextResponse.json({ error: "This account is read-only." }, { status: 403 });
  }

  const { job: jobParam } = await context.params;
  if (!isJobKey(jobParam)) return NextResponse.json({ error: `Unknown job ${jobParam}` }, { status: 404 });
  const job = JOBS[jobParam];

  const base = (process.env[job.baseUrlEnv] ?? "").replace(/\/+$/, "");
  if (!base) {
    return NextResponse.json(
      { error: `${job.baseUrlEnv} is not set, so HALO does not know where the ${job.service} service lives.` },
      { status: 503 },
    );
  }

  let body: { projectCode?: string; startDate?: string; endDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Re-read the sheet id server-side: the client's view could be stale, and the
  // job silently does nothing when it is missing.
  const rows = (await listConfigs(job.service)) as ProjectConfigRow[];
  const row = rows.find((candidate) => String(candidate.project_code ?? "") === body.projectCode);
  if (!row) return NextResponse.json({ error: `No ${job.service} project ${body.projectCode}.` }, { status: 404 });

  const sheetId = readSheetId(row[job.sheetColumn]);
  const problems = validateJobInput(body, { sheetId });
  if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

  const payload = job.buildPayload({
    projectCode: body.projectCode as string,
    startDate: body.startDate as string,
    endDate: body.endDate as string,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${job.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    console.log(
      `[halo][job] ${job.key} project=${body.projectCode} range=${body.startDate}..${body.endDate} ` +
        `actor=${session.email ?? "local"} status=${res.status}`,
    );

    return NextResponse.json(
      {
        ok: res.ok,
        status: res.status,
        // What HALO actually sent, so a surprising result is diagnosable.
        sent: { url: `${base}${job.path}`, payload },
        result: parsed ?? text.slice(0, 4000),
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? `The ${job.service} service did not respond within ${TIMEOUT_MS / 1000}s. It may still be running — check its CloudWatch logs before retrying.`
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
