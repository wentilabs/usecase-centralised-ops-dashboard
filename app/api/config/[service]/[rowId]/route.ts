import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { effectiveChanges, validateChanges } from "@/lib/config-values";
import {
  annotateAudit,
  getConfig,
  getFieldSpec,
  updateConfig,
} from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICES, isServiceKey } from "@/lib/services";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ service: string; rowId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) {
    return NextResponse.json(
      { error: "Your account has read-only access to the dashboard." },
      { status: 403 },
    );
  }

  const { service, rowId: rawRowId } = await params;
  if (!isServiceKey(service)) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  const rowId = decodeURIComponent(rawRowId);

  const body = (await request.json().catch(() => ({}))) as {
    changes?: Record<string, unknown>;
    baseUpdatedAt?: string | null;
    note?: string;
  };

  const spec = await getFieldSpec(service);
  const before = await getConfig(service, rowId);
  if (!before) return NextResponse.json({ error: `${rowId} not found` }, { status: 404 });

  // Validate everything against the live schema before touching the database.
  const { patch, rejected } = validateChanges(spec.fields, body.changes ?? {});
  if (rejected.length) {
    return NextResponse.json({ error: "Invalid changes", rejected }, { status: 400 });
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No changes supplied" }, { status: 400 });
  }

  const effective = effectiveChanges(before as Record<string, unknown>, patch);
  if (!Object.keys(effective).length) {
    return NextResponse.json({ ok: true, unchanged: true, row: before });
  }

  let rows;
  try {
    rows = await updateConfig(service, rowId, effective, body.baseUpdatedAt ?? null);
  } catch (error) {
    return NextResponse.json(
      { error: `Supabase rejected the change: ${error instanceof Error ? error.message : error}` },
      { status: 502 },
    );
  }

  if (!rows.length) {
    const current = await getConfig(service, rowId);
    return NextResponse.json(
      {
        error: "This project changed in Supabase since you opened the editor — reload and re-apply.",
        current,
      },
      { status: 409 },
    );
  }

  const after = rows[0];
  const changes = Object.fromEntries(
    Object.keys(effective).map((key) => [
      key,
      { from: (before as Record<string, unknown>)[key] ?? null, to: (after as Record<string, unknown>)[key] ?? null },
    ]),
  );

  // The Postgres trigger already recorded the change; stamp it with who and why.
  const audit = await annotateAudit({
    table: SERVICES[service].table,
    rowId,
    newUpdatedAt: after.updated_at,
    actorEmail: session.actor,
    note: (body.note ?? "").slice(0, 500),
  });

  return NextResponse.json({ ok: true, row: after, changes, audit });
}
