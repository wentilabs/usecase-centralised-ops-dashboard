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
 * people stop reading. The strip replaced it: it is the same shape on every
 * card, so an idle project and a failing one are compared rather than read.
 */
/**
 * Lifted above the card's mobile tap overlay (`z-20`), because a `z-30` on the
 * strip itself did nothing: this section's `relative` made it the enclosing
 * stacking context, so the strip's z-index was only ever compared with its own
 * siblings. The section is what has to clear the overlay.
 *
 * It is then transparent to taps except for the strip, so tapping the pill still
 * opens the card the way tapping anywhere else on it does, and only the strip
 * takes a tap for itself.
 */
export function DataHealthRow({
  projectCode,
  health,
  bars = [],
  fault,
}: {
  projectCode: string;
  health?: ProjectHealth;
  bars?: Bar[];
  /** A state the project is stuck in, with no instant to put on a strip. */
  fault?: string;
}) {
  // No per-project ingestion reading. Haze and Lightning live here by design —
  // their NEA source is one public feed for the whole estate, so there is
  // nothing per-project to report about the fetch — and they do have a real
  // delivery history underneath, which the strip shows.
  //
  // The section used to say "nothing reads this service yet" in this case. That
  // sentence is gone: an empty strip of a hundred grey columns says the same
  // thing more precisely — nothing has happened for this project in 48 hours —
  // and it says it in the same shape as every other card, so the absence is
  // comparable against its neighbours instead of being a different kind of
  // statement that has to be read.
  if (!health) {
    return (
      <section className="pointer-events-none relative z-30 mt-auto border-t border-border pt-2.5" aria-label="Data health">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Data health{bars.length ? " — delivery" : ""}
        </div>
        <StandingFault message={fault} />
        <HealthBars projectCode={projectCode} bars={bars} />
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
    <section className="pointer-events-none relative z-30 mt-auto border-t border-border pt-2.5" aria-label="Data health">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Data health</div>
      <StandingFault message={fault} />
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>{label}</span>
        {health.newestReceivedAt ? (
          <span className="text-[11px] text-muted-foreground">{formatSgt(health.newestReceivedAt)} SGT</span>
        ) : null}
      </div>
      {/* A finding must say why. Amber and red carry what was expected, what was
          seen and what the service itself reported, so the next move is a search
          for that sentence and not a guess. Green and idle say nothing extra. */}
      {health.evidence?.length && colour !== "green" ? (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] leading-snug text-muted-foreground">
          {health.evidence.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {/* The shape, under the words: the pill says what is true now, the bars
          say whether it has been true all week or since an hour ago. */}
      <HealthBars projectCode={projectCode} bars={bars} />
    </section>
  );
}

/**
 * A project stuck in a state, shown ABOVE its strip.
 *
 * Lightning rejects SGK's configuration on every tick and has never evaluated it,
 * so SGK has no processes and its strip is a hundred calm grey columns — which
 * reads as "nothing to report" for a site with no lightning protection. The
 * strip cannot carry this, because there is no instant to hang it on; this can.
 *
 * Red and written out in full, in the service's own words, because the reader's
 * next move is to fix the configuration and the message says which field.
 */
function StandingFault({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-1.5 break-words rounded-lg bg-danger/15 px-2 py-1 text-[11px] font-medium text-danger ring-1 ring-danger/30"
    >
      {message}
    </p>
  );
}
