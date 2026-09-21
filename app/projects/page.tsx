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
      {error ? <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn"><p className="font-medium">Registry is not available yet.</p><p className="mt-1">{error}</p><p className="mt-2">Apply <code>supabase/create_canonical_projects.sql</code>, then refresh this page.</p></div> : null}
      {/* The heading and the filter live together in the grid, because ⌘F has
          to reach the box and the box belongs in the corner with these links.
          The page keeps what only the server knows: whether the registry read,
          and what this session may do. */}
      <CanonicalProjectGrid
        projects={projects}
        actions={
          <>
            <Link href="/" className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:border-primary">← Dashboard</Link>
            {session.canEdit && !error ? <Link href="/projects/import" className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:border-primary">Rebuild</Link> : null}
            {session.canEdit ? <Link href="/projects/new" className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Create project</Link> : null}
          </>
        }
      />
    </main>
  );
}
