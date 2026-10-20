"use client";

import { formatSgt } from "@/lib/card-summary";

/**
 * "Refresh data health": forget what is remembered and read it all again.
 *
 * Labelled "Refresh health", not "Refresh": the header already has a Refresh that reloads the page's
 * configuration, and two buttons of the same name would leave nobody sure which one they pressed.
 *
 * Health is held for a while on purpose — the strips cost a second of paging each — which is right
 * for a page left open and wrong for someone who has just fixed a sheet and wants to know whether it
 * has cleared. Without this the only ways to find out were to wait out a five-minute cache or reload
 * the whole page, which re-reads configuration, group names and everything else nobody asked about.
 *
 * It says what it is doing, because the read takes a second or two and a button that does nothing
 * visible is clicked twice: "Refreshing…" while it runs, the time it finished afterwards, and a plain
 * sentence if it could not, in which case what was on screen is left exactly as it was.
 */
export function RefreshHealthButton({
  onRefresh,
  refreshing,
  refreshedAt,
  failed,
  className = "",
}: {
  onRefresh: () => void;
  refreshing: boolean;
  /** When the last refresh finished, as an ISO time. */
  refreshedAt: string | null;
  failed: boolean;
  className?: string;
}) {
  const status = refreshing
    ? "Refreshing…"
    : failed
      ? "Could not refresh — showing what was already here"
      : refreshedAt
        ? `Updated ${formatSgt(refreshedAt)} SGT`
        : null;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh data health"
        title="Forget what Data Health remembers and read it all again"
        className="whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1 text-[13px] transition-colors hover:border-primary disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span> Refresh health
      </button>
      {status ? (
        <span role="status" className={`text-[11px] ${failed ? "text-danger" : "text-muted-foreground"}`}>
          {status}
        </span>
      ) : null}
    </span>
  );
}
