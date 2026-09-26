"use client";

import type { ServiceData } from "./DashboardShell";

export function DataHealthBoard({ services, onClose }: { services: ServiceData[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/65 p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Data Health board">
      <section className="mx-auto max-h-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border pb-4">
          <div><h2 className="text-xl font-semibold">Data Health</h2><p className="mt-1 text-sm text-muted-foreground">Configure monitoring and operations recipients per project and source service.</p></div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-border px-3 py-2 text-xs hover:border-primary">Close</button>
        </header>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {services.map((service) => (
            <article key={service.key} className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-semibold">{service.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{service.rows.length} configured projects · delivery monitoring not configured</p>
              <button type="button" disabled className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">Set up policy (database migration required)</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
