"use client";

import { formatSgt } from "@/lib/card-summary";
import type { ServiceKey } from "@/lib/services";
import { useBodyScrollLock, useEscapeKey } from "@/lib/use-body-scroll-lock";

export type DrawerService = {
  key: ServiceKey;
  label: string;
  count: number;
  failed: boolean;
};

/**
 * Mobile-only navigation drawer.
 *
 * The desktop header lays five service tabs, the counts, the fetch time, two
 * refresh buttons and the operator's identity across one row. None of that fits
 * a phone, so on mobile it all moves in here and the top bar keeps only what an
 * operator needs constantly: which service they are in, and the search box.
 */
export function ServiceDrawer({
  services,
  activeKey,
  onSelect,
  onClose,
  fetchedAt,
  session,
  names,
  onRefreshData,
  onRefreshNames,
  dataBusy = false,
}: {
  services: DrawerService[];
  activeKey: ServiceKey;
  onSelect: (key: ServiceKey) => void;
  onClose: () => void;
  fetchedAt: string;
  session: { email: string | null; canEdit: boolean; isLocalBypass: boolean };
  names: { configured: boolean; storeReady: boolean; refreshedAt: string | null; busy: boolean };
  onRefreshData: () => void;
  onRefreshNames: () => void;
  dataBusy?: boolean;
}) {
  useBodyScrollLock(true);
  useEscapeKey(true, onClose);

  return (
    <div className="md:hidden">
      <div className="fixed inset-0 z-40 bg-black/65" onClick={onClose} />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Services and actions"
        className="fixed inset-y-0 left-0 z-50 flex w-[min(19rem,84vw)] flex-col border-r border-border bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 pb-3 pt-safe">
          <h2 className="flex-1 text-sm font-semibold leading-snug">🗂️ HALO Centralised Services</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs"
          >
            ✕
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">Service</p>
          <ul className="flex flex-col gap-1.5">
            {services.map((service) => {
              const active = service.key === activeKey;
              return (
                <li key={service.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(service.key);
                      onClose();
                    }}
                    aria-current={active ? "page" : undefined}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm ${
                      active
                        ? "border-primary bg-primary text-primary-foreground font-semibold"
                        : "border-border bg-card"
                    }`}
                  >
                    <span className="flex-1">{service.label}</span>
                    {service.failed ? (
                      <span className="text-danger" title="This service failed to load">
                        ⚠
                      </span>
                    ) : null}
                    <span className={active ? "text-primary-foreground/70 text-xs" : "text-muted-foreground text-xs"}>
                      {service.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mb-2 mt-5 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">Refresh</p>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={onRefreshData}
              disabled={dataBusy}
              className="rounded-xl border border-border bg-card px-3 py-3 text-left text-sm disabled:opacity-50"
            >
              {dataBusy ? "Refreshing…" : "⟳ Configs & columns"}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                fetched {formatSgt(fetchedAt)} SGT
              </span>
            </button>

            {names.configured ? (
              <button
                type="button"
                onClick={onRefreshNames}
                disabled={names.busy}
                className="rounded-xl border border-border bg-card px-3 py-3 text-left text-sm disabled:opacity-50"
              >
                {names.busy ? "Aliasing…" : names.storeReady ? "⟳ Chat aliases" : "⚠ Chat aliases"}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {names.refreshedAt ? `names as of ${formatSgt(names.refreshedAt)} SGT` : "not resolved yet"}
                </span>
              </button>
            ) : null}
          </div>
        </nav>

        <footer className="shrink-0 border-t border-border px-4 pt-3 text-xs text-muted-foreground pb-safe">
          {session.isLocalBypass && !session.email ? (
            <span className="rounded-full bg-muted px-2 py-0.5">local</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-all">{session.email}</span>
              {session.canEdit ? null : (
                <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn">
                  read-only
                </span>
              )}
            </span>
          )}
        </footer>
      </aside>
    </div>
  );
}
