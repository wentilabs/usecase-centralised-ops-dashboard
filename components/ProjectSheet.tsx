"use client";

import type { ReactNode } from "react";

import { autoLinks, deliveryGroups, firesAt, formatSgt, pillsFor } from "@/lib/card-summary";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";
import { useBodyScrollLock, useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * Mobile-only full-detail sheet.
 *
 * Phone cards carry a deliberately thin summary; this is where the rest of it
 * lives — every switch, every delivery group with its Viso link, the derived
 * sheets and map, and the way into the editor. Marked `md:hidden` so that even
 * a mid-session resize to desktop can never surface it.
 */
export function ProjectSheet({
  service,
  label,
  config,
  rowId,
  canEdit,
  onEdit,
  onClose,
  groupNames = {},
  visoUrl = null,
}: {
  service: ServiceKey;
  label: string;
  config: ProjectConfigRow;
  rowId: string;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
  groupNames?: Record<string, string>;
  visoUrl?: string | null;
}) {
  useBodyScrollLock(true);
  useEscapeKey(true, onClose);

  const enabled = config.enabled !== false;
  const groups = deliveryGroups(service, config);
  const links = autoLinks(service, config);
  const pills = pillsFor(service, config);
  const projectCode = String(config.project_code ?? rowId);

  return (
    <div className="md:hidden">
      <div className="fixed inset-0 z-40 bg-black/65" onClick={onClose} />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${label} ${projectCode}`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl"
      >
        {/* Grab handle: the usual signal that this panel is dismissable. */}
        <div className="flex shrink-0 justify-center pb-1 pt-2" onClick={onClose}>
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>

        <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{label}</span>
              <span className="break-all">{projectCode}</span>
            </h2>
            <p className={`mt-1 text-[11px] font-semibold ${enabled ? "text-on" : "text-muted-foreground"}`}>
              {enabled ? "● ENABLED" : "○ DISABLED"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <Section title="Fires at">
            <p className="text-sm text-muted-foreground">{firesAt(service, config)}</p>
          </Section>

          <Section title="Switches">
            <div className="flex flex-wrap gap-1.5">
              {pills.map((pill) => (
                <span
                  key={pill.label}
                  className={
                    pill.on
                      ? "rounded-full bg-on/15 px-2.5 py-1 text-xs text-on ring-1 ring-on/30"
                      : "rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground line-through"
                  }
                >
                  {pill.label}
                </span>
              ))}
            </div>
          </Section>

          <Section title={`Delivery${groups.length > 1 ? ` · ${groups.length} groups` : ""}`}>
            {groups.length ? (
              <ul className="flex flex-col gap-1.5">
                {groups.map(({ chatId, role }) => {
                  const name = groupNames[chatId];
                  const href = visoUrl ? `${visoUrl}/go/${encodeURIComponent(chatId)}` : undefined;
                  const body = (
                    <>
                      <span className="block truncate text-sm">💬 {name ?? chatId}</span>
                      {/* The id is what Supabase actually stores — keep it visible. */}
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {chatId}
                      </span>
                      {role ? (
                        <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {role}
                        </span>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={chatId}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener"
                          className="block rounded-xl border border-border bg-card px-3 py-2.5 active:border-primary"
                        >
                          {body}
                        </a>
                      ) : (
                        <div className="rounded-xl border border-border bg-card px-3 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No group configured.</p>
            )}
          </Section>

          {links.length ? (
            <Section title="Links">
              <div className="flex flex-col gap-1.5">
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener"
                    className="rounded-xl border border-primary/35 bg-primary/5 px-3 py-2.5 text-sm font-medium text-primary active:bg-primary/15"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card p-3 text-xs">
              <dt className="text-muted-foreground">source</dt>
              <dd className="break-words">{String(config.source_type ?? "default")}</dd>
              <dt className="text-muted-foreground">timezone</dt>
              <dd>{String(config.timezone ?? "Asia/Singapore")}</dd>
              <dt className="text-muted-foreground">row id</dt>
              <dd className="break-all font-mono text-[10px]">{rowId}</dd>
              <dt className="text-muted-foreground">updated</dt>
              <dd>{formatSgt(config.updated_at)} SGT</dd>
            </dl>
          </Section>
        </div>

        <footer className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-safe">
          {canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:opacity-85"
            >
              ⚙︎ Edit configuration
            </button>
          ) : (
            <p className="py-1 text-center text-xs text-muted-foreground">
              Read-only account — configs cannot be changed from here.
            </p>
          )}
        </footer>
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
