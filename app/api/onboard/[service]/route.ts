import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  callRpc,
  insertConfig,
  insertRows,
  listConfigs,
} from "@/lib/config-repository";
import {
  buildInsertRow,
  missingEnvDefaults,
  onboardingFor,
  prefillDefaults,
  validateDraft,
} from "@/lib/onboarding";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICES, isServiceKey } from "@/lib/services";
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
  const defaults = Object.fromEntries(
    definition.fields
      .filter((field) => field.envDefault)
      .map((field) => [field.column, !missing.includes(field.envDefault as string)]),
  );
  // Actual values, so the dialog prefills the URL rather than naming the env var.
  // Every one of these is already shown in the editor for existing projects.
  // Probing the RPC with a deliberately invalid code separates "not installed"
  // (404) from "installed and rejecting bad input" (400) — the latter proves it
  // is present without creating anything.
  let rpcInstalled: boolean | null = null;
  if (definition.rpc) {
    const probe = await callRpc(SERVICES[service].schema, definition.rpc.fn, definition.rpc.args("1"));
    rpcInstalled = probe.status !== 404;
  }

  return NextResponse.json({
    ok: true,
    missingEnvDefaults: missing,
    defaultsResolved: defaults,
    prefill: prefillDefaults(definition, process.env),
    rpc: definition.rpc ? { fn: definition.rpc.fn, describes: definition.rpc.describes, installed: rpcInstalled } : null,
  });
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

  const projectCode = String(draft.project_code ?? "").trim();
  const { schema } = SERVICES[service];
  const steps: { step: string; detail: string }[] = [];

  // 1. Anything that must exist before the row does. For WBGT that is the
  //    project's readings table, which is DDL and so runs as a definer function.
  //    Done first on purpose: a config row pointing at a table that was never
  //    created is the confusing half-onboarded state this avoids.
  if (definition.rpc) {
    const result = await callRpc(schema, definition.rpc.fn, definition.rpc.args(projectCode));
    if (result.status === 404) {
      return NextResponse.json(
        {
          error: `${definition.rpc.fn} is not installed on the database, so HALO cannot create ${definition.rpc.describes}. Run supabase/migrate_onboarding_rpc.sql in the ${service} repo, then try again.`,
        },
        { status: 503 },
      );
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: `Could not create ${definition.rpc.describes}: ${result.text.slice(0, 300)}` },
        { status: 502 },
      );
    }
    steps.push({ step: definition.rpc.describes, detail: String(result.body ?? definition.rpc.expects(projectCode)) });
  }

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
  steps.push({ step: "config row", detail: `${SERVICES[service].table} · ${projectCode}` });

  // 2. Companion rows. A failure here leaves a real, editable config row behind
  //    rather than rolling back, so it is reported instead of thrown — the row
  //    is recoverable by hand and losing it would be worse.
  let companionError: string | null = null;
  if (definition.companion) {
    try {
      const rows = definition.companion.build(draft, projectCode);
      await insertRows(schema, definition.companion.table, rows, {
        onConflict: definition.companion.onConflict,
      });
      steps.push({
        step: `${definition.companion.label} row`,
        detail: `${definition.companion.table} · ${rows.map((r) => String(r.sensor_label ?? "")).join(", ")}`,
      });
    } catch (error) {
      companionError = error instanceof Error ? error.message : String(error);
    }
  }

  // Deliberately not written through the audit annotation path: that stamps an
  // UPDATE recorded by the table's trigger, and this is an INSERT with no prior
  // state to diff against. The row's own created_at is the record.
  console.log(
    `[halo][onboard][${service}] created ${String(created[0].project_code ?? "?")} by ${session.actor ?? "?"}`,
  );

  return NextResponse.json({
    ok: true,
    row: created[0],
    disabled: true,
    steps,
    ...(companionError
      ? { warning: `The ${definition.companion?.label} row could not be written: ${companionError}. The project row exists — add it by hand.` }
      : {}),
  });
}
