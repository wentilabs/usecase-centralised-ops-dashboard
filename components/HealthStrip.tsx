"use client";

import { summaryLine, type BoardSummary } from "@/lib/health-board";

/**
 * The one line that speaks for the whole estate, on every tab.
 *
 * This is the piece the dashboard did not have. Health lived inside each
 * project card, so it could only ever answer "is THIS project well" — and only
 * once you had already chosen a service tab and scrolled to the card. A red
 * project in Subcon was invisible to someone working in Noise, which is exactly
 * the case where being told matters.
 *
 * It is permanent rather than conditional, and that is deliberate even though a
 * quiet line costs a row of chrome: a warning that appears only when something
 * is wrong teaches nobody where to look, and its absence is indistinguishable
 * from the feature being broken. A reader who can see "nothing to action" knows
 * the check ran.
 */
export function HealthStrip({ summary, onOpen }: { summary: BoardSummary; onOpen: () => void }) {
  const actionable = summary.red + summary.amber;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Data health: ${summaryLine(summary)}. Open the list.`}
      className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1 text-[13px] transition-colors hover:border-primary ${
        summary.red
          ? "border-danger/50 bg-danger/10 text-danger"
          : summary.amber
            ? "border-warn/50 bg-warn/10 text-warn"
            : "border-border bg-card text-muted-foreground"
      }`}
    >
      <span className="font-medium">Data health</span>
      {/* The counts carry their own colour so red reads as red even in the
          amber-bordered state, where a single tone would flatten them. */}
      {summary.red ? <span className="font-semibold text-danger">● {summary.red}</span> : null}
      {summary.amber ? <span className="font-semibold text-warn">● {summary.amber}</span> : null}
      {actionable ? null : <span>{summaryLine(summary)}</span>}
      {/* Idle is said out loud rather than folded into a green count: most of
          the estate is outside its cadence hours for most of the day, and a
          reader needs to know the difference between quiet and working. */}
      {!actionable && summary.idle ? (
        <span className="text-[11px] opacity-70">· {summary.idle} idle</span>
      ) : null}
    </button>
  );
}
