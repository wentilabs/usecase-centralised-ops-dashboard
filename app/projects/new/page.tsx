import { redirect } from "next/navigation";

import { CanonicalProjectEditor } from "@/components/CanonicalProjectEditor";
import { blankCanonicalProjectDraft } from "@/lib/canonical-projects";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewCanonicalProjectPage() {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");
  return <CanonicalProjectEditor initial={blankCanonicalProjectDraft()} canEdit={session.canEdit} />;
}
