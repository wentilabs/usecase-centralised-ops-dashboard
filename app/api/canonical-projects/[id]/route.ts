import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  annotateAudit,
  getCanonicalProject,
  updateCanonicalProject,
} from "@/lib/config-repository";
import { validateCanonicalProjectDraft } from "@/lib/canonical-projects";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * `GET` / `PATCH /api/canonical-projects/{id}` — `getCanonicalProject` and
 * `updateCanonicalProject` in the OpenAPI contract. Updates HALO's registry,
 * never a live service configuration row.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const project = await getCanonicalProject((await params).id);
    return project ? NextResponse.json({ project }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) return NextResponse.json({ error: "Your account has read-only access to the dashboard." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { draft?: unknown; baseUpdatedAt?: string | null; note?: string };
  const { draft, problems } = validateCanonicalProjectDraft(body.draft);
  if (!draft) return NextResponse.json({ error: "Invalid canonical project", problems }, { status: 400 });

  const id = (await params).id;
  try {
    const project = await updateCanonicalProject(id, draft, body.baseUpdatedAt ?? null);
    if (!project) {
      return NextResponse.json(
        { error: "This canonical project changed since you opened it — reload and review the current values." },
        { status: 409 },
      );
    }
    const audit = await annotateAudit({
      table: "projects",
      rowId: project.id,
      newUpdatedAt: project.updated_at,
      actorEmail: session.actor,
      note: (body.note ?? "Updated canonical project registry entry").slice(0, 500),
    });
    return NextResponse.json({ ok: true, project, audit });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
