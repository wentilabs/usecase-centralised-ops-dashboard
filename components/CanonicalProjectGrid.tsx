"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CompanyMark } from "./CompanyMark";
import { ServiceTag } from "./ServiceTag";
import { canonicalProjectMatches, type CanonicalProject } from "@/lib/canonical-projects";
import { shouldFocusPropose, shouldFocusSearch } from "@/lib/search-hotkey";
import { SERVICES, SERVICE_KEYS, type ServiceKey } from "@/lib/services";

function ProjectCard({ project }: { project: CanonicalProject }) {
  return (
    // `relative` and `overflow-hidden`: the mark is absolutely positioned and
    // sized in pixels, so without clipping it escapes a short card.
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary">
      {project.company ? <CompanyMark
          company={project.company}
          align="right"
          opacity="opacity-25"
          // As large as fits: the card is 158px, so 145 leaves a hair of
          // margin top and bottom and nothing is clipped. No per-asset scale
          // applies at this alignment, so every logo draws to this same box.
          box="h-[145px] w-[230px]"
        /> : null}

      {/* The whole card opens the project. A stretched overlay rather than an
          anchor around everything, so the card stays a plain container and
          anything interactive added later can sit above it on z-10 instead of
          being nested inside a link. */}
      <Link
        href={`/projects/${project.id}`}
        className="absolute inset-0 z-0"
        aria-label={`Open ${project.primary_alias}`}
      />

      <div className="pointer-events-none relative z-0">
        <span className="font-mono font-semibold group-hover:underline">{project.primary_alias}</span>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {project.site_name ?? project.company ?? "No site name or company"}
        </p>
        {project.site_address ? <p className="mt-1 text-xs text-muted-foreground">{project.site_address}</p> : null}
      </div>

      {/* The dashboard's own service pills, in the dashboard's order, so a
          service is the same colour and the same word wherever you meet it. */}
      {/* Every service, always, in the dashboard's order — the ones this
          project has in their own colour, the rest greyed out. Showing only
          what exists made each card a different height and turned "is noise
          set up here" into a counting exercise. The workbook and map links
          that used to sit below are gone with it: four links plus a map row
          cost more vertical space than the identity above them, and the card
          already opens the project where they all live. */}
      <div className="pointer-events-none relative z-0 mt-3 flex flex-wrap gap-1">
        {SERVICE_KEYS.map((service) => {
          const alias = project.service_aliases[service];
          return (
            <ServiceTag
              key={service}
              service={service}
              muted={!alias}
              title={alias ? `${SERVICES[service].label}: ${alias}` : `${SERVICES[service].label}: not onboarded`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * The canonical projects registry, as cards rather than a three-column list.
 *
 * Full width and a denser grid because this is a directory: the question it
 * answers is "which site is this and where are its things", and the previous
 * layout showed a name, one line of subtitle and a count of aliases — every
 * link it could have offered was one navigation away.
 */
export function CanonicalProjectGrid({ projects }: { projects: CanonicalProject[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // ⌘F / Ctrl+F, on the same rule the dashboard uses — including its escape
  // hatch, so a second press still reaches the browser's own find.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const node = search.current;
      if (!node) return;
      if (shouldFocusSearch(event, document.activeElement === node)) {
        event.preventDefault();
        node.focus();
        node.select();
        return;
      }
      // ⌘P belongs to Propose everywhere, but the bar that reviews and applies
      // what it returns lives on the dashboard. Route there focused rather
      // than grow a second one here with nothing behind it.
      if (shouldFocusPropose(event, false)) {
        event.preventDefault();
        router.push("/?propose=1");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const shown = useMemo(() => projects.filter((project) => canonicalProjectMatches(project, query)), [projects, query]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Code, alias, company, site or address…  (⌘F · ⌘P to propose)"
          className="w-full max-w-md rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <span className="text-xs text-muted-foreground">
          {shown.length === projects.length ? `${projects.length} projects` : `${shown.length} of ${projects.length}`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {shown.map((project) => <ProjectCard key={project.id} project={project} />)}
        {!shown.length ? (
          <p className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {projects.length ? `Nothing matches “${query}”.` : "No canonical projects yet. Review reconstructed candidates before creating records."}
          </p>
        ) : null}
      </div>
    </>
  );
}
