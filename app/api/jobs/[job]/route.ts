import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { JOBS, eachDate, isJobKey, validateJobInput } from "@/lib/jobs";
import { listConfigs } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import type { ProjectConfigRow } from "@/lib/services";

export const dynamic = "force-dynamic";

/** These jobs write to Google Sheets and can walk a long date range. */
const TIMEOUT_MS = 60_000;

/**
 * The sentence a service returned, from wherever it put it.
 *
 * The alert services answer `{ success: false, error }`; some return plain text.
 * Without this the callers saw only HALO's own 502 wrapper, which named the
 * status and nothing else — "status 502" told an operator nothing about a body
 * key the endpoint does not accept.
 */
function upstreamMessage(result: unknown, status: number): string {
  if (result && typeof result === "object") {
    const asRecord = result as Record<string, unknown>;
    for (const key of ["error", "message", "reason"]) {
      const value = asRecord[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof result === "string" && result.trim()) return result.trim().slice(0, 400);
  return `The service returned ${status} with nothing this could read.`;
}

/**
 * `POST /api/jobs/{job}` — `runJob` in the OpenAPI contract.
 *
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
  // Jobs are their own scope, not covered by `write`. A token that may edit
  // configuration should not automatically be able to drive a CloudLynx browser
  // session or make a service send WhatsApp messages to a site group.
  if (!session.scopes.includes("jobs")) {
    return NextResponse.json(
      { error: "This credential lacks the `jobs` scope, which triggering a job requires." },
      { status: 403 },
    );
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

  let body: {
    projectCode?: string;
    startDate?: string;
    endDate?: string;
    flags?: Record<string, boolean>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Re-check the precondition server-side: the client's view could be stale,
  // and every one of these jobs reports success while doing nothing when it is
  // unmet (no sheet id to write to, or no upstream to scrape).
  const rows = (await listConfigs(job.service)) as ProjectConfigRow[];
  const row = rows.find((candidate) => String(candidate.project_code ?? "") === body.projectCode);
  if (!row) return NextResponse.json({ error: `No ${job.service} project ${body.projectCode}.` }, { status: 404 });

  const ready = job.precondition.read(row);
  const reason = ready ? null : (job.precondition.detail?.(row, body.projectCode as string) ?? null);
  const problems = validateJobInput(body, { job, ready, reason });
  if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

  // Only flags the job actually declares are forwarded.
  const allowed = new Set((job.flags ?? []).map((flag) => flag.key));
  const flags = Object.fromEntries(
    Object.entries(body.flags ?? {}).filter(([key, value]) => allowed.has(key) && value === true),
  );

  /**
   * One upstream call per date for a `perDay` job, one for the whole range
   * otherwise. `noise-sheet-sync` takes a single `date`; sending it a range was
   * silently ignored until INV-NOISE-15's strict body check turned it into a 400.
   *
   * Sequential, with a deadline. These write Google Sheets against a quota
   * shared by every service on one credential, so firing a fortnight of dates at
   * once is the fastest way to a 429 — and a long range would otherwise run past
   * whatever request timeout sits in front of this route with nothing to show.
   * Running out of budget reports how far it got; the job is idempotent, so the
   * operator re-runs from the date named.
   */
  const dates = job.perDay ? eachDate(body.startDate as string, body.endDate as string) : [null];
  const deadline = Date.now() + TIMEOUT_MS;
  const perDate: { date: string | null; status: number; result: unknown }[] = [];
  let lastPayload: Record<string, unknown> = {};

  try {
    for (const date of dates) {
      if (Date.now() > deadline) break;
      lastPayload = job.buildPayload({
        projectCode: body.projectCode as string,
        startDate: body.startDate as string,
        endDate: body.endDate as string,
        ...(date ? { date } : {}),
        flags,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1_000, deadline - Date.now()));
      let res: Response;
      let text: string;
      try {
        res = await fetch(`${base}${job.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lastPayload),
          cache: "no-store",
          signal: controller.signal,
        });
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      perDate.push({ date, status: res.status, result: parsed ?? text.slice(0, 2000) });

      console.log(
        `[halo][job] ${job.key} project=${body.projectCode} ${date ? `date=${date}` : `range=${body.startDate}..${body.endDate}`} ` +
          `flags=${JSON.stringify(flags)} actor=${session.email ?? "local"} status=${res.status}`,
      );

      // Stop at the first failure rather than hammering the same fault 11 more
      // times — and the reason is the same for every remaining date anyway.
      if (!res.ok) break;
    }

    const failed = perDate.find((entry) => entry.status < 200 || entry.status >= 300);
    const remaining = dates.length - perDate.length;
    const ok = !failed && !remaining;

    return NextResponse.json(
      {
        ok,
        status: failed?.status ?? 200,
        // Surfaced as `error` because that is the field both callers read; the
        // upstream message was previously only inside `result`, so a failure
        // rendered as a bare "status 502" and said nothing about why.
        ...(ok
          ? {}
          : {
              error: failed
                ? upstreamMessage(failed.result, failed.status) +
                  (failed.date ? ` (on ${failed.date})` : "")
                : `Ran out of time after ${perDate.length} of ${dates.length} dates. ` +
                  `Re-run from ${dates[perDate.length]} — this job is idempotent.`,
            }),
        sent: { url: `${base}${job.path}`, payload: lastPayload },
        ...(job.perDay ? { dates: dates.length, completed: perDate.filter((e) => e.status < 300).length } : {}),
        result: job.perDay ? perDate : (perDate[0]?.result ?? null),
      },
      { status: ok ? 200 : 502 },
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
  }
}
