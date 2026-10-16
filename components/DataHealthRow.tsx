import { formatSgt } from "@/lib/card-summary";
import { HealthBars } from "./HealthBars";
import type { Bar } from "@/lib/health-timeline";
import { colourOfTone } from "@/lib/health-board";
import type { ProjectHealth } from "@/lib/data-health";

/**
 * One project's health, on its own card.
 *
 * Two rules, and both exist because this pill is drawn 196 times:
 *
 * **Green stays short.** A healthy project says "receiving" and nothing else.
 * Nearly two hundred fully-labelled green pills is wallpaper — the eye has
 * nothing to catch on, and the one red pill carries the same weight as its
 * thirty healthy neighbours.
 *
 * **Amber and red carry the service's own words.** The status is printed
 * unrewritten, so the abnormal pills are physically longer and heavier on the
 * page. That makes a problem findable by PRESENCE rather than only by hue,
 * which survives a phone screen and colour blindness — and the string shown is
 * the one a reader will grep the logs for.
 *
 * The old second pill, "Delivery: not monitored", is gone. It said nothing on
 * every card in the estate, and a section that is mostly noise is a section
 * people stop reading. It returns when there is a delivery outcome to put in it.
 */
export function DataHealthRow({ health, bars = [] }: { health?: ProjectHealth; bars?: Bar[] }) {
  // No reading at all is not the same as a healthy reading, and must not be
  // dressed as one. Every service declares delivery, so this is not about what
  // they would report — it is that nothing reads it yet.
  if (!health) {
    return (
      <section className="relative z-10 border-t border-border pt-2.5" aria-label="Data health">
        <p className="text-[11px] text-muted-foreground">Data health — nothing reads this service yet.</p>
        <HealthBars bars={bars} />
      </section>
    );
  }

  const colour = colourOfTone(health.tone);
  const label = health.label.replace(/^Data:\s*/i, "");
  const tone =
    colour === "red"
      ? "bg-danger/15 text-danger ring-danger/30"
      : colour === "amber"
        ? "bg-warn/15 text-warn ring-warn/30"
        : "bg-on/15 text-on ring-on/30";

  return (
    <section className="relative z-10 border-t border-border pt-2.5" aria-label="Data health">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Data health</div>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>{label}</span>
        {health.newestReceivedAt ? (
          <span className="text-[11px] text-muted-foreground">{formatSgt(health.newestReceivedAt)} SGT</span>
        ) : null}
      </div>
      {/* The shape, under the words: the pill says what is true now, the bars
          say whether it has been true all week or since an hour ago. */}
      <HealthBars bars={bars} />
    </section>
  );
}
