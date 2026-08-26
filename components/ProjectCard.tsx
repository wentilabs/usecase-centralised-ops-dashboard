"use client";

import { autoLinks, cardEmphasis, deliveryGroups, firesAt, formatSgt, pillsFor } from "@/lib/card-summary";
import { CompanyMark } from "./CompanyMark";
import { tagLabel } from "@/lib/services";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";

/**
 * Service pill colour, one hue each.
 *
 * The hues are spread deliberately: amber 45°, sky 200°, orange 30°, violet
 * 270°, cyan 190°, lime 85°, rose 350°. Subcon was emerald (160°), which sat
 * between cyan and sky and read as a third blue-green at 11px. Lime is the
 * widest gap left in the wheel — yellow-green, and far enough from amber's gold
 * to be told apart at a glance.
 *
 * Adding a service means picking a hue that is not already within ~30° of one
 * of these.
 */
const TAG_TONE: Record<ServiceKey, string> = {
  wbgt: "bg-amber-400/15 text-amber-300",
  noise: "bg-sky-400/15 text-sky-300",
  haze: "bg-orange-400/15 text-orange-300",
  lightning: "bg-violet-400/15 text-violet-300",
  ailytics: "bg-cyan-400/15 text-cyan-300",
  subcon: "bg-lime-400/15 text-lime-300",
  issueChaser: "bg-rose-400/15 text-rose-300",
};

/**
 * Per-service status wording.
 *
 * Subcon has two independent switches and no master: `enable_housekeeping`
 * gates the intake route, `enabled` gates the morning report, and neither
 * implies the other (INV-HK-01 in the subcon repo's AGENTS.md). So its badge
 * says ACTIVE while either is on, and only "BOTH ROUTES OFF" means idle.
 */
const STATUS_WORDING: Partial<Record<ServiceKey, { on: string; off: string }>> = {
  subcon: { on: "● ACTIVE", off: "○ BOTH ROUTES OFF" },
};

/**
 * Whether this project is switched on, by whichever column the service uses.
 *
 * Not every service spells it `enabled`: subcon's master switch is
 * `enable_housekeeping` since the reduction dropped `enabled`. Reading
 * `config.enabled !== false` for that service would report every project as on,
 * because the column is absent rather than false.
 */
function isProjectOn(service: ServiceKey, config: ProjectConfigRow): boolean {
  // Subcon has two independent switches and `enabled` is not the master one: it
  // governs the outbound morning report only, while `enable_housekeeping` gates
  // the intake. A project doing either is on.
  if (service === "subcon") return config.enable_housekeeping !== false || config.enabled !== false;
  return config.enabled !== false;
}

/**
 * How many switches a phone-width card shows before deferring the rest to the
 * detail sheet. Four fits two lines at 360px without pushing the fires-at line
 * off the fold.
 */
const MOBILE_PILL_LIMIT = 4;

/** Only rendered on md+, so nothing here needs a mobile variant. */
function Chip({
  label,
  value,
  title,
  href,
}: {
  label: string;
  value: string;
  title?: string;
  href?: string;
}) {
  const className = "rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px]";

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        title={title}
        className={`${className} relative z-10 hover:border-primary hover:text-primary`}
      >
        <span className="text-muted-foreground">{label}</span> {value}
      </a>
    );
  }

  return (
    <span title={title} className={className}>
      <span className="text-muted-foreground">{label}</span> {value}
    </span>
  );
}

export function ProjectCard({
  service,
  config,
  rowId,
  canEdit,
  onEdit,
  onOpen,
  groupNames = {},
  visoUrl = null,
}: {
  service: ServiceKey;
  config: ProjectConfigRow;
  rowId: string;
  canEdit: boolean;
  onEdit: () => void;
  /** Tapping the card on mobile opens the full-detail sheet. */
  onOpen: () => void;
  /** chat id → group name; ids absent from the map render as the raw id. */
  groupNames?: Record<string, string>;
  /** Base URL of Viso; when set, chips link to the mirrored thread. */
  visoUrl?: string | null;
}) {
  const enabled = isProjectOn(service, config);
  // Three states: scheduled, running on manual photo ingestion, or idle. A
  // manual project has no cadence but is live, so it gets a lighter scrim than
  // an idle one and says so on the header row.
  const emphasis = cardEmphasis(service, config);
  const groups = deliveryGroups(service, config);
  const links = autoLinks(service, config);
  const wording = STATUS_WORDING[service] ?? { on: "● ENABLED", off: "○ DISABLED" };

  /**
   * What an empty group list means, which is not the same thing everywhere.
   *
   * Issue Chaser recovers the destination from the issue's own row in the Safety
   * sheet when `send_to_originating_groups` is on — which is the default — so a
   * blank group list is the intended configuration, not a missing one. Saying
   * "no group configured" there reports a problem that does not exist.
   */
  const noGroupWording =
    service === "issueChaser" && config.send_to_originating_groups !== false
      ? "replies in each issue's originating group"
      : "no group configured";

  // Mobile keeps only the switches that are actually on, capped. Chosen by
  // index so services with repeated labels can't collide.
  /**
   * The chip's icon: a droplet when this group also receives Water Parade.
   *
   * Read off the role `deliveryGroups` already assigns from
   * `water_parade_outbound_group_id`, rather than re-reading the column here, so
   * the icon cannot disagree with the tooltip beside it. WBGT is the only
   * service with that column, so every other service keeps the speech bubble
   * without a special case.
   */
  const groupIcon = (role?: string) => (role?.includes("water parade") ? "💧" : "💬");

  const pills = pillsFor(service, config);
  const mobilePills = new Set<number>();
  // Toned pills first — a caution or a called-out capability is the reason to
  // look at the card at all, and would otherwise hide behind the "+N".
  pills.forEach((pill, index) => {
    if (pill.tone && mobilePills.size < MOBILE_PILL_LIMIT) mobilePills.add(index);
  });
  pills.forEach((pill, index) => {
    if (pill.on && mobilePills.size < MOBILE_PILL_LIMIT) mobilePills.add(index);
  });
  const hiddenPillCount = pills.length - mobilePills.size;

  return (
    <article
      className={[
        "relative flex flex-col gap-2.5 rounded-2xl p-3.5 shadow-soft md:gap-3 md:p-4",
        "bg-card",
        // A disabled project is the one you most need to find — it is what a
        // newly created project looks like, and opening its card is the only way
        // to switch it on. It used to carry `opacity-60` AND a 45% scrim, which
        // stacked into something unreadable: present in the DOM but effectively
        // invisible, so a new project could not be enabled from the UI at all.
        // The amber border and badge carry the signal now.
        enabled ? "border border-border" : "border-2 border-warn/50",
        // One scrim, never two. Three depths, each a step apart: manual
        // ingestion is dimmest because those cards do real work on a photo,
        // disabled sits in the middle behind its amber border, and a card with
        // nothing scheduled at all is darkest. When a card is both disabled and
        // idle the disabled wash wins rather than compounding.
        //
        // Each was raised one step from 15/20/25, which was too faint to read
        // as inactive against `bg-card`. The ceiling is the old 45% wash that,
        // stacked with `opacity-60`, made a disabled card impossible to find —
        // the border and badge carry the signal, the scrim only supports it.
        !enabled
          ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:bg-black/30"
          : emphasis !== "active"
            ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl " +
              (emphasis === "manual" ? "after:bg-black/25" : "after:bg-black/35")
            : "",
      ].join(" ")}
    >
      {/* Identity, as a shape rather than a word: a project code says nothing
          about whose site it is, and "Wohhup" on 90-odd cards cost a line of
          width to say what a mark says at a glance. Painted behind the content
          and inert, so it can never intercept a click. */}
      {config.company ? <CompanyMark company={String(config.company)} /> : null}

      {/* The whole card is one tap target on mobile; on desktop the card stays
          inert and its individual links/buttons do the work. Sits above the
          no-cadence scrim so a disabled project is still openable. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${String(config.project_code ?? rowId)} details`}
        className="tap-target absolute inset-0 z-20 rounded-2xl active:bg-white/5 md:hidden"
      />

      <h2 className="flex items-center gap-2 text-base font-semibold">
        {/* Short form: this sits beside a project code, so "Subcon Activities"
            wrapped onto two lines. The tab keeps the full name. */}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONE[service]}`}>
          {tagLabel(service)}
        </span>
        {String(config.project_code ?? rowId)}
        <span
          className={`ml-auto shrink-0 text-[11px] font-semibold ${
            enabled ? "text-on" : "rounded-md bg-warn/20 px-1.5 py-0.5 text-warn"
          }`}
        >
          <span className="md:hidden">{enabled ? "●" : "○"}</span>
          <span className="hidden md:inline">{enabled ? wording.on : wording.off}</span>
        </span>
        {emphasis === "manual" ? (
          <span
            title="Readings arrive as photos: the CloudLynx scraper is off and photo source chats are configured."
            className="rounded-md bg-warn/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn ring-1 ring-warn/40"
          >
            Manual
          </span>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="relative z-10 hidden rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary md:block"
          >
            ⚙︎ Edit
          </button>
        ) : null}
        <span aria-hidden className="text-muted-foreground md:hidden">
          ›
        </span>
      </h2>

      <div className="flex flex-wrap gap-1.5">
        {pills.map((pill, index) => (
          <span
            key={pill.label}
            className={[
              pill.tone === "info"
                ? "rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-primary/40"
                : pill.tone === "warn"
                  ? "rounded-full bg-warn/20 px-2 py-0.5 text-[11px] font-semibold text-warn ring-1 ring-warn/40"
                  : pill.on
                    ? "rounded-full bg-on/15 px-2 py-0.5 text-[11px] text-on ring-1 ring-on/30"
                    : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground line-through",
              mobilePills.has(index) ? "" : "hidden md:block",
            ].join(" ")}
          >
            {pill.label}
          </span>
        ))}
        {hiddenPillCount > 0 ? (
          <span className="rounded-full px-1 py-0.5 text-[11px] text-muted-foreground md:hidden">
            +{hiddenPillCount}
          </span>
        ) : null}
      </div>

      <div>
        <div className="mb-0.5 hidden text-[10px] uppercase tracking-wider text-muted-foreground md:block">
          Fires at
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground md:line-clamp-none">
          <span aria-hidden className="md:hidden">
            🕒{" "}
          </span>
          {firesAt(service, config)}
        </p>
      </div>

      {/* Delivery: one truncated line on mobile, the full chip list on desktop. */}
      <p className="truncate text-xs text-muted-foreground md:hidden">
        {groups.length
          ? `${groupIcon(groups[0].role)} ${groupNames[groups[0].chatId] ?? groups[0].chatId}${groups.length > 1 ? ` +${groups.length - 1}` : ""}`
          : `💬 ${noGroupWording}`}
      </p>

      <div className="hidden md:block">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Delivery</div>
        <div className="flex flex-wrap gap-1">
          {groups.length ? (
            groups.map(({ chatId, role }) => (
              <Chip
                key={chatId}
                label={groupIcon(role)}
                value={groupNames[chatId] ?? chatId}
                // Keep the id reachable — it is what Supabase actually stores.
                title={
                  [role, groupNames[chatId] ? `${groupNames[chatId]} · ${chatId}` : chatId]
                    .filter(Boolean)
                    .join(" — ") + (visoUrl ? " · open the mirrored thread in Viso" : "")
                }
                href={visoUrl ? `${visoUrl}/go/${encodeURIComponent(chatId)}` : undefined}
              />
            ))
          ) : (
            <Chip label="" value={noGroupWording} />
          )}
        </div>
      </div>

      {links.length ? (
        <div className="hidden flex-wrap gap-2 md:flex">
          {links.map((link) => (
            <a
              key={link.label}
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

      <footer className="mt-auto flex justify-between border-t border-border pt-1.5 text-[11px] text-muted-foreground md:pt-2">
        <span className="hidden md:inline">
          {String(config.source_type ?? "default")} · {String(config.timezone ?? "Asia/Singapore")}
        </span>
        <span className="ml-auto">updated {formatSgt(config.updated_at)}</span>
      </footer>
    </article>
  );
}
