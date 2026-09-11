import { NextResponse } from "next/server";

import { describePostgrestError } from "@/lib/postgrest-error";
import type { NextRequest } from "next/server";

import { effectiveChanges, validateChanges } from "@/lib/config-values";
import { explainConstraint, newProblems } from "@/lib/row-rules";
import {
  annotateAudit,
  getConfig,
  getFieldSpec,
  updateConfig,
} from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICES, isServiceKey } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `PATCH /api/config/{service}/{rowId}` — `updateProjectConfig` in the contract.
 *
 * **The only route in HALO that writes a project configuration.** Everything that
 * changes a live service's behaviour comes through here: the editor's save, a
 * chat proposal the operator confirmed, and every row of a bulk change. Keeping
 * it the single write path is why none of those needed a write surface of their
 * own to secure.
 *
 * Four gates, in order, and each is here rather than in a caller because a caller
 * can be bypassed:
 *   1. signed in, and `canEdit` — a reader cannot write even with a valid body;
 *   2. `validateChanges` against the LIVE introspected schema, so an unknown
 *      column or a value outside a CHECK is a 400 before the database is touched;
 *   3. `baseUpdatedAt` optimistic concurrency — a stale write is a 409, not a
 *      silent overwrite of whoever edited the row in between;
 *   4. an audit row, annotated with the caller and the optional `note`.
 *
 * Parameters and the body shape are declared in `lib/openapi.ts` and served at
 * `/openapi.json`; they are not repeated here, so there is one copy to keep true.
 */

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

  /**
   * The multi-column CHECKs, against the row as it WILL be — not against the
   * change-set, because each of these rules spans fields and the other half
   * is usually one nobody touched in this save.
   *
   * Refused here so the answer names the fields. The database would refuse it
   * anyway, in the form of a constraint name and a row truncated mid-URL.
   */
  const label = (column: string) => spec.fields[column]?.label ?? column;
  const problems = newProblems(
    service,
    before as Record<string, unknown>,
    { ...(before as Record<string, unknown>), ...patch },
    label,
  );
  if (problems.length) {
    return NextResponse.json(
      {
        error: problems.map((problem) => problem.message).join(" "),
        problems: problems.map((problem) => ({ columns: problem.columns, message: problem.message })),
      },
      { status: 400 },
    );
  }

  let rows;
  try {
    rows = await updateConfig(service, rowId, effective, body.baseUpdatedAt ?? null);
  } catch (error) {
    // A rule this app does not mirror, or mirrors wrongly. Say what the
    // constraint is about when it is one we know; otherwise pass through the
    // tidied Postgres text, which at least names the constraint.
    const raw = describePostgrestError(error);
    const rule = explainConstraint(service, raw);
    return NextResponse.json(
      {
        error: rule
          ? `${rule.check({ ...(before as Record<string, unknown>), ...patch }, label) ?? raw}`
          : `Supabase rejected the change: ${raw}`,
        ...(rule ? { problems: [{ columns: rule.columns, message: raw }] } : {}),
      },
      { status: rule ? 400 : 502 },
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
