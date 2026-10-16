"use client";

import { healthyShare, shareText, type Bar } from "@/lib/health-timeline";
import { summaryLine, type BoardSummary } from "@/lib/health-board";

/**
 * The estate's recent cycles, one bar each, newest on the right.
 *
 * Prominence is the point. Data Health was a button with two numbers on it,
 * which is readable only by someone already looking for it — and the thing
 * worth noticing is usually a CHANGE, which no count can show. Fifty bars make
 * "clean for two days, then every cycle amber from 10:00" visible without
 * reading anything, and the bar is wide enough to be the first thing on the
 * page rather than a chip in the corner.
 *
 * Clicking anywhere opens the board, where the amber and red bars are named.
 */
export function HealthTimeline({
  bars,
  summary,
  onOpen,
}: {
  bars: Bar[];
  summary: BoardSummary;
  onOpen: () => void;
}) {
  const share = healthyShare(bars);
  const worst = summary.red ? "red" : summary.amber ? "amber" : "green";

  const fill = (colour: Bar["colour"]) =>
    colour === "red"
      ? "bg-danger"
      : colour === "amber"
        ? "bg-warn"
        : colour === "green"
          ? "bg-on"
          : // An hour nothing was recorded in. Faint, and deliberately not green:
            // it is a cycle that did not run, which is its own fact.
            "bg-muted";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Data health — ${summaryLine(summary)}. Open the list.`}
      className={`group w-full rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary ${
        worst === "red" ? "border-danger/50" : worst === "amber" ? "border-warn/50" : "border-border"
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data health
        </span>
        <span
          className={`text-[11px] font-semibold ${
            worst === "red" ? "text-danger" : worst === "amber" ? "text-warn" : "text-on"
          }`}
        >
          {summaryLine(summary)}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          open ›
        </span>
      </div>

      {/* `items-stretch` with a fixed height, so every bar is the same length:
          the colour carries the meaning, and a varying height would imply a
          magnitude the data does not have. */}
      <div className="flex h-9 items-stretch gap-[2px]">
        {bars.map((bar) => (
          <span
            key={bar.hour}
            title={`${bar.hour.replace("T", " ")}:00 UTC — ${
              bar.colour ? `${bar.count} attempt${bar.count === 1 ? "" : "s"}, worst ${bar.colour}` : "no cycle"
            }`}
            className={`flex-1 rounded-[1px] ${fill(bar.colour)} ${bar.colour ? "" : "opacity-40"}`}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="whitespace-nowrap">{bars.length} hours ago</span>
        <span className="h-px flex-1 bg-border" />
        <span className="whitespace-nowrap font-medium">{shareText(share)} of cycles clean</span>
        <span className="h-px flex-1 bg-border" />
        <span className="whitespace-nowrap">Now</span>
      </div>
    </button>
  );
}
