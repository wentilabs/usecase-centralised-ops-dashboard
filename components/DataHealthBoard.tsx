"use client";

import type { ServiceData } from "./DashboardShell";
import type { ProjectHealth } from "@/lib/data-health";

export function DataHealthBoard({ services, projectHealth, onClose }: { services: ServiceData[]; projectHealth: ProjectHealth[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/65 p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Data Health board">
      <section className="mx-auto max-h-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border pb-4">
          <div><h2 className="text-xl font-semibold">Data Health</h2><p className="mt-1 text-sm text-muted-foreground">WBGT and Noise source tables are automatically monitored. Delivery monitoring is not part of this pilot.</p></div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-border px-3 py-2 text-xs hover:border-primary">Close</button>
        </header>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {services.map((service) => {
            const monitored = service.key === "wbgt" || service.key === "noise";
            const health = projectHealth.filter((item) => item.service === service.key);
            const good = health.filter((item) => item.tone === "good").length;
            const warn = health.filter((item) => item.tone === "warn").length;
            const danger = health.filter((item) => item.tone === "danger").length;
            return (
              <article key={service.key} className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-semibold">{service.label}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {monitored ? `${service.rows.length} configured projects · automatically monitored` : `${service.rows.length} configured projects · not yet covered`}
                </p>
                {monitored ? <p className="mt-3 text-xs text-muted-foreground"><span className="text-on">{good} receiving</span> · <span className="text-warn">{warn} delayed</span> · <span className="text-danger">{danger} needs attention</span></p> : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
