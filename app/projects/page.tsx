import { redirect } from "next/navigation";
import Link from "next/link";

import { CanonicalProjectGrid } from "@/components/CanonicalProjectGrid";
import { listCanonicalProjects } from "@/lib/config-repository";
import type { CanonicalProject } from "@/lib/canonical-projects";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CanonicalProjectsPage() {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");

  let projects: CanonicalProject[];
  let error: string | null = null;
  try {
    projects = await listCanonicalProjects();
  } catch (cause) {
    projects = [];
    error = cause instanceof Error ? cause.message : String(cause);
  }

  // Full width: this is a directory, and a 6xl column left four fifths of a
  // wide screen empty while the cards queued three abreast.
  return (
    <main className="flex w-full flex-col gap-4 px-3 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Canonical projects</h1><p className="mt-1 text-sm text-muted-foreground">Human-approved site identity and common resources. Service configuration stays in its owning service.</p></div>
        <div className="flex gap-2"><Link href="/" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">← Dashboard</Link>{session.canEdit ? <Link href="/projects/new" className="rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Create project</Link> : null}</div>
      </div>
      {error ? <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn"><p className="font-medium">Registry is not available yet.</p><p className="mt-1">{error}</p><p className="mt-2">Apply <code>supabase/create_canonical_projects.sql</code>, then refresh this page.</p></div> : null}
      {!error ? <div className="flex justify-end">{session.canEdit ? <Link href="/projects/import" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">Rebuild from current projects</Link> : null}</div> : null}
      <CanonicalProjectGrid projects={projects} />
    </main>
  );
}
