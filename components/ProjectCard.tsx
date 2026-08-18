"use client";

import { autoLinks, firesAt, formatSgt, hasCadence, pillsFor, splitList } from "@/lib/card-summary";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";

const TAG_TONE: Record<ServiceKey, string> = {
  wbgt: "bg-amber-400/15 text-amber-300",
  noise: "bg-sky-400/15 text-sky-300",
  haze: "bg-orange-400/15 text-orange-300",
  lightning: "bg-violet-400/15 text-violet-300",
  ailytics: "bg-cyan-400/15 text-cyan-300",
};

function Chip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px]"
    >
      <span className="text-muted-foreground">{label}</span> {value}
    </span>
  );
}

export function ProjectCard({
  service,
  label,
  config,
  rowId,
  canEdit,
  onEdit,
}: {
  service: ServiceKey;
  label: string;
  config: ProjectConfigRow;
  rowId: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const enabled = config.enabled !== false;
  const scheduled = hasCadence(service, config);
  const groups = splitList(config.whatsapp_group_id ?? config.wa_group_ids ?? config.whatsapp_group_ids);

  return (
    <article
      className={[
        "relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft",
        enabled ? "" : "opacity-60",
        scheduled ? "" : "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:bg-black/45",
      ].join(" ")}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONE[service]}`}>{label}</span>
        {String(config.project_code ?? rowId)}
        <span className={`ml-auto text-[11px] font-semibold ${enabled ? "text-on" : "text-muted-foreground"}`}>
          {enabled ? "● ENABLED" : "○ DISABLED"}
        </span>
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="relative z-10 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            ⚙︎ Edit
          </button>
        ) : null}
      </h2>

      <div className="flex flex-wrap gap-1.5">
        {pillsFor(service, config).map((pill) => (
          <span
            key={pill.label}
            className={
              pill.on
                ? "rounded-full bg-on/15 px-2 py-0.5 text-[11px] text-on ring-1 ring-on/30"
                : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground line-through"
            }
          >
            {pill.label}
          </span>
        ))}
      </div>

      <div>
        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Fires at</div>
        <p className="text-xs text-muted-foreground">{firesAt(service, config)}</p>
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Delivery</div>
        <div className="flex flex-wrap gap-1">
          {groups.length ? (
            groups.map((group) => <Chip key={group} label="💬" value={group} title="WhatsApp group" />)
          ) : (
            <Chip label="" value="no group configured" />
          )}
        </div>
      </div>

      {autoLinks(config).length ? (
        <div className="flex flex-wrap gap-2">
          {autoLinks(config).map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener"
              className="relative z-10 rounded-lg border border-primary/35 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}

      <footer className="mt-auto flex justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span>{String(config.source_type ?? "default")} · {String(config.timezone ?? "Asia/Singapore")}</span>
        <span>updated {formatSgt(config.updated_at)}</span>
      </footer>
    </article>
  );
}
