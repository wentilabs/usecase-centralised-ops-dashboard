"use client";

import { useState } from "react";

import { CanonicalProjectEditor } from "./CanonicalProjectEditor";
import type { CanonicalProjectCandidate } from "@/lib/canonical-projects";
import { SERVICES } from "@/lib/services";

/** Review-first importer. Candidates are derived from service rows but remain inert until saved. */
export function CanonicalProjectCandidates({
  candidates,
  canEdit,
  unavailableServices = [],
}: {
  candidates: CanonicalProjectCandidate[];
  canEdit: boolean;
  /** Sources omitted from this read; candidates must not be treated as complete. */
  unavailableServices?: string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const candidate = candidates.find((entry) => entry.key === selected) ?? null;

  if (candidate) {
    return <CanonicalProjectEditor initial={candidate.draft} canEdit={canEdit} conflicts={candidate.conflicts} />;
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Rebuild canonical projects</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            These are suggestions from current service rows. Nothing has been written, and ambiguous values are deliberately left for review.
          </p>
        </div>
        <a href="/projects" className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary">← Projects</a>
      </div>

      {unavailableServices.length ? (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          <p className="font-medium">This reconstruction is incomplete.</p>
          <p className="mt-1">HALO could not read: {unavailableServices.map((service) => SERVICES[service as keyof typeof SERVICES].label).join(", ")}. Resolve those source reads and reload before approving any candidate.</p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-3 py-3">Primary alias</th><th className="px-3 py-3">Other aliases</th><th className="px-3 py-3">Services found</th><th className="px-3 py-3">Review</th><th className="px-3 py-3" /></tr>
          </thead>
          <tbody>
            {candidates.map((entry) => (
              <tr key={entry.key} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-3 font-mono font-medium">{entry.draft.primary_alias}</td>
                <td className="px-3 py-3 text-muted-foreground">{entry.draft.alternate_aliases.join(", ") || "—"}</td>
                <td className="px-3 py-3">{Object.keys(entry.draft.service_aliases).map((service) => SERVICES[service as keyof typeof SERVICES].shortLabel ?? SERVICES[service as keyof typeof SERVICES].label).join(" · ") || "—"}</td>
                <td className="px-3 py-3">{entry.cluster.tier === "suggested" || entry.conflicts.length ? <span className="text-warn">Needs decision</span> : <span className="text-on">Ready to review</span>}</td>
                <td className="px-3 py-3 text-right"><button type="button" onClick={() => setSelected(entry.key)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:border-primary">Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
