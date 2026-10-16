import { healthyShare, shareText, type Bar } from "@/lib/health-timeline";

/**
 * One site's recent cycles, on its own card.
 *
 * A pill says what is true now. It cannot say whether this has been happening
 * all week or started an hour ago — and that is usually the question that
 * locates the cause. Haze is the case in point: every project went amber at
 * once at 10:00 after two clean days, which a pill renders as thirty-one
 * independent faults and a strip renders as one thing that changed at 10:00.
 *
 * Deliberately small and quiet. It is drawn on 196 cards, so it carries no
 * heading of its own and borrows the section's; what it adds is the SHAPE,
 * which is legible at this size even when the individual bars are not.
 */
export function HealthBars({ bars }: { bars: Bar[] }) {
  if (!bars.length) return null;

  const share = healthyShare(bars);
  const fill = (colour: Bar["colour"]) =>
    colour === "red"
      ? "bg-danger"
      : colour === "amber"
        ? "bg-warn"
        : colour === "green"
          ? "bg-on"
          : // No cycle in that hour. Faint, and never green: an hour nothing ran
            // in is not an hour that succeeded.
            "bg-muted-foreground/25";

  return (
    <div className="mt-2">
      {/* `gap-px` rather than a wider gap: at 50 bars in a card this wide the
          bars are about 4px, and anything more spends the width on gaps. */}
      <div className="flex h-5 items-stretch gap-px" aria-hidden>
        {bars.map((bar) => (
          <span
            key={bar.hour}
            title={`${bar.hour.replace("T", " ")}:00 UTC — ${
              bar.colour ? `${bar.count} attempt${bar.count === 1 ? "" : "s"}, worst ${bar.colour}` : "no cycle"
            }`}
            className={`flex-1 rounded-[1px] ${fill(bar.colour)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span className="whitespace-nowrap">{bars.length}h ago</span>
        <span className="h-px flex-1 bg-border" />
        <span className="whitespace-nowrap tabular-nums">{shareText(share)} clean</span>
        <span className="h-px flex-1 bg-border" />
        <span className="whitespace-nowrap">now</span>
      </div>
    </div>
  );
}
