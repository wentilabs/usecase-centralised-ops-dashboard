"use client";

import { useState } from "react";

import { formatSgt } from "@/lib/card-summary";
import { healthyShare, shareText, troubleCount, troubleIn, type Bar } from "@/lib/health-timeline";

const FILL: Record<string, string> = {
  red: "bg-danger",
  amber: "bg-warn",
  green: "bg-on",
};

/**
 * One site's last fifty processes, on its own card.
 *
 * A pill says what is true now. It cannot say whether this has been happening
 * all week or started an hour ago — and that is usually the question that
 * locates the cause. Haze is the case in point: every project went amber at
 * once after two clean days, which a pill renders as thirty-one independent
 * faults and a strip renders as one thing that changed.
 *
 * A bar is one PROCESS — a run or a delivery attempt — not an hour, because the
 * estate has no shared cadence: Noise assesses every few minutes and Subcon
 * reports twice a day, and on an hourly axis the twice-daily project is
 * forty-eight blanks and two bars. Ordinal bars also mean every bar is a real
 * event, which is what makes the strip worth clicking.
 *
 * Collapsed it is deliberately small and quiet — it is drawn on 196 cards and
 * borrows the section's heading. Clicking lists the amber and red ones, which
 * is the only part anybody needs the detail of.
 */
export function HealthBars({ bars }: { bars: Bar[] }) {
  const [open, setOpen] = useState(false);
  if (!bars.length) return null;

  const trouble = troubleIn(bars);
  const troubled = troubleCount(bars);
  const share = healthyShare(bars);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-label={`Last ${bars.length} processes, ${shareText(share)} clean. ${
          troubled ? `Show the ${troubled} that were not.` : "Nothing to show."
        }`}
        className="group block w-full text-left"
      >
        {/* `gap-px`: at fifty bars in a card this wide each is about 4px, and
            anything more spends the width on gaps. */}
        <span className="flex h-5 items-stretch gap-px">
          {bars.map((bar, index) => (
            <span
              key={`${bar.at}-${index}`}
              title={`${formatSgt(bar.at)} SGT — ${bar.status}`}
              className={`flex-1 rounded-[1px] ${FILL[bar.colour]}`}
            />
          ))}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <span className="whitespace-nowrap">{bars.length} ago</span>
          <span className="h-px flex-1 bg-border" />
          <span className="whitespace-nowrap tabular-nums">{shareText(share)} clean</span>
          <span className="h-px flex-1 bg-border" />
          <span className="whitespace-nowrap">
            {troubled ? (
              <span className="underline decoration-dotted group-hover:text-foreground">
                {open ? "hide" : `${troubled} to see`}
              </span>
            ) : (
              "now"
            )}
          </span>
        </span>
      </button>

      {/* Grouped, not one line per process: twenty-six identical
          `completed_with_issues` lines is one chronic fault rendered as
          twenty-six events. The status is the service's own word, so it can be
          grepped, and the span says how long it has been going on. */}
      {open && trouble.length ? (
        <ul className="mt-1.5 flex flex-col gap-1 border-t border-border pt-1.5">
          {trouble.map((group) => (
            <li key={group.status} className="flex flex-wrap items-baseline gap-x-1.5 text-[10px]">
              <span className={group.colour === "red" ? "text-danger" : "text-warn"}>●</span>
              <span className="font-mono">{group.status}</span>
              {group.count > 1 ? <span className="font-medium tabular-nums">×{group.count}</span> : null}
              <span className="ml-auto whitespace-nowrap text-muted-foreground">
                {group.count > 1 && group.from !== group.to
                  ? `${formatSgt(group.from)} → ${formatSgt(group.to)}`
                  : formatSgt(group.to)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
