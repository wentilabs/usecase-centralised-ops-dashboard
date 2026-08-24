import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { insertConfig, listConfigs } from "@/lib/config-repository";
import { buildInsertRow, missingEnvDefaults, onboardingFor, validateDraft } from "@/lib/onboarding";
import { getDashboardSession } from "@/lib/supabase/server";
import { isServiceKey } from "@/lib/services";
import type { ProjectConfigRow } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Create a project row.
 *
 * GET reports what the server can supply — which env-backed defaults are set, and
 * the project codes already taken — so the dialog can warn before anything is
 * typed rather than after it is submitted.
 *
 * POST re-validates server-side. The client's list of existing rows can be stale,
 * and the composite unique key means a stale read turns into a Postgres constraint
 * error that reads like a bug.
 */

export async function GET(request: NextRequest, context: { params: Promise<{ service: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { service } = await context.params;
  if (!isServiceKey(service)) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  const definition = onboardingFor(service);
  if (!definition) return NextResponse.json({ error: `${service} has no onboarding flow.` }, { status: 404 });

  const missing = missingEnvDefaults(definition, process.env);
  // Only whether each default resolved, never the URL itself.
  const defaults = Object.fromEntries(
    definition.fields
      .filter((field) => field.envDefault)
      .map((field) => [field.column, !missing.includes(field.envDefault as string)]),
  );
  return NextResponse.json({ ok: true, missingEnvDefaults: missing, defaultsResolved: defaults });
}

export async function POST(request: NextRequest, context: { params: Promise<{ service: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) {
    return NextResponse.json({ error: "Your account has read-only access to the dashboard." }, { status: 403 });
  }

  const { service } = await context.params;
  if (!isServiceKey(service)) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  const definition = onboardingFor(service);
  if (!definition) return NextResponse.json({ error: `${service} has no onboarding flow.` }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { draft?: Record<string, string> };
  const draft = body.draft ?? {};

  const existing = (await listConfigs(service)) as ProjectConfigRow[];
  const problems = validateDraft(definition, draft, existing);
  if (problems.length) return NextResponse.json({ error: problems.join(" "), problems }, { status: 400 });

  const row = buildInsertRow(definition, draft, process.env);

  let created;
  try {
    created = await insertConfig(service, row);
  } catch (error) {
    return NextResponse.json(
      { error: `Supabase rejected the insert: ${error instanceof Error ? error.message : error}` },
      { status: 502 },
    );
  }
  if (!created.length) {
    return NextResponse.json({ error: "The insert returned no row." }, { status: 502 });
  }

  // Deliberately not written through the audit annotation path: that stamps an
  // UPDATE recorded by the table's trigger, and this is an INSERT with no prior
  // state to diff against. The row's own created_at is the record.
  console.log(
    `[halo][onboard][${service}] created ${String(created[0].project_code ?? "?")} by ${session.actor ?? "?"}`,
  );

  return NextResponse.json({ ok: true, row: created[0], disabled: true });
}
