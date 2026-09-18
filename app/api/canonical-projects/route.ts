import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  annotateAudit,
  insertCanonicalProject,
  listCanonicalProjects,
} from "@/lib/config-repository";
import { validateCanonicalProjectDraft } from "@/lib/canonical-projects";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET` / `POST /api/canonical-projects` — `listCanonicalProjects` and
 * `createCanonicalProject` in the OpenAPI contract. Reads or creates HALO's
 * canonical registry only; it never changes a service configuration row.
 */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ projects: await listCanonicalProjects() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) return NextResponse.json({ error: "Your account has read-only access to the dashboard." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { draft?: unknown };
  const { draft, problems } = validateCanonicalProjectDraft(body.draft);
  if (!draft) return NextResponse.json({ error: "Invalid canonical project", problems }, { status: 400 });

  try {
    const project = await insertCanonicalProject(draft);
    const audit = await annotateAudit({
      table: "projects",
      rowId: project.id,
      newUpdatedAt: project.updated_at,
      actorEmail: session.actor,
      note: "Created canonical project registry entry",
    });
    return NextResponse.json({ ok: true, project, audit });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
