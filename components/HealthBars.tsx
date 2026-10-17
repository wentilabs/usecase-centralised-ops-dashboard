"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { formatSgt } from "@/lib/card-summary";
import { BAR_COUNT, troubleCount, troubleIn, type Bar } from "@/lib/health-timeline";

const FILL: Record<string, string> = {
  red: "bg-danger",
  amber: "bg-warn",
  green: "bg-on",
};

/**
 * One site's last hundred processes, on its own card.
 *
 * A pill says what is true now. It cannot say whether this has been happening
 * all week or started an hour ago — and that is usually the question that
 * locates the cause. Haze is the case in point: every project went amber at
 * once after two clean days, which a pill renders as thirty-one independent
 * faults and a strip renders as one thing that changed.
 *
 * A bar is one PROCESS — a run or a delivery attempt — not an hour, because the
 * estate has no shared cadence: Noise assesses every few minutes and Subcon
 * reports twice a day, and on an hourly axis the twice-daily project would be
 * ninety-eight blanks and two bars.
 *
 * **Every bar is the same width and every strip the same length.** The strip is
 * always padded to `BAR_COUNT` slots and the width is divided equally between
 * them, so the bars are the same size on every card AND fill it. Both halves
 * matter: a strip of four stretched bars reads as four long-running things,
 * which is the opposite of what a short history means, while a fixed-width bar
 * left a third of the card empty and the strip read as shoved to the right.
 *
 * The padding is drawn, never counted: it is not a process, not a colour, and
 * not part of anything the strip reports. It says "there is nothing older
 * here", which on a 48-hour window is a true and useful thing to see.
 */
export function HealthBars({ projectCode, bars }: { projectCode: string; bars: Bar[] }) {
  const [open, setOpen] = useState(false);
  const trouble = troubleIn(bars);
  const troubled = troubleCount(bars);
  const worst = trouble.some((bar) => bar.colour === "red") ? "red" : "amber";

  // Escape closes it, like every other dialog here.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!troubled}
        aria-label={
          troubled
            ? `Last ${bars.length} processes for ${projectCode}. Show the ${troubled} that need looking at.`
            : bars.length
              ? `Last ${bars.length} processes for ${projectCode}, nothing to action.`
              : `No processes for ${projectCode} in the last 48 hours.`
        }
        // The section around this is `pointer-events-none` and sits above the
        // card's mobile tap overlay; this is the one part of it that takes a tap.
        // Without that, the strip was visible on a phone and unopenable, because
        // the overlay swallows every tap inside the card to open the editor.
        //
        // Still `pointer-events-none` when there is nothing to show, so an idle
        // project's strip does not punch a dead hole in the overlay: a disabled
        // button still hit-tests, so it would block the tap without using it.
        className="group pointer-events-auto block w-full text-left disabled:pointer-events-none disabled:cursor-default"
      >
        {/* Fixed-width bars, right-aligned so the newest is always at the same
            place and a short history does not stretch to fill the card. */}
        <span className="flex h-7 items-stretch gap-px md:h-5">
          {/* Empty slots first, so the newest process is always hard against
              the right edge whatever this project's history looks like. */}
          {Array.from({ length: Math.max(0, BAR_COUNT - bars.length) }, (_, index) => (
            <span
              key={`pad-${index}`}
              title="no process in the last 48 hours"
              className="min-w-0 flex-1 rounded-[1px] bg-muted-foreground/15"
            />
          ))}
          {bars.map((bar, index) => (
            <span
              key={`${bar.at}-${index}`}
              title={`${formatSgt(bar.at)} SGT — ${bar.status}`}
              className={`min-w-0 flex-1 rounded-[1px] ${FILL[bar.colour]}`}
            />
          ))}
        </span>
        {/* The middle slot carries what to DO, not how well it went — a score
            there invites "is that bad?", which nobody can answer without
            knowing the service. */}
        <span className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <span className="whitespace-nowrap">{bars.length ? `${bars.length} ago` : "48h"}</span>
          <span className="h-px flex-1 bg-border" />
          {troubled ? (
            <span
              className={`whitespace-nowrap font-medium underline decoration-dotted group-hover:text-foreground ${
                worst === "red" ? "text-danger" : "text-warn"
              }`}
            >
              {troubled} to look at
            </span>
          ) : (
            <span className="whitespace-nowrap">{bars.length ? "nothing to action" : "no activity"}</span>
          )}
          <span className="h-px flex-1 bg-border" />
          <span className="whitespace-nowrap">now</span>
        </span>
      </button>

      {open ? <TroubleDialog projectCode={projectCode} trouble={trouble} onClose={() => setOpen(false)} /> : null}

    </div>
  );
}

/**
 * Every amber and red process, one row each, newest first.
 *
 * Not grouped. A grouped line — "completed_with_issues ×26" — answers how often,
 * which is the wrong question once somebody has decided to look: what they need
 * is when each one happened and what the service said about it, because that is
 * what distinguishes one sensor failing all day from a different sensor each
 * hour. The count is already on the strip that opened this.
 *
 * The status stays the service's own word and the log lines are reproduced
 * verbatim, so both can be grepped against the service's own logs.
 */
function TroubleDialog({
  projectCode,
  trouble,
  onClose,
}: {
  projectCode: string;
  trouble: Bar[];
  onClose: () => void;
}) {
  // Portalled to the body, not left in the card.
  //
  // `fixed inset-0 z-50` is not enough from inside a project card: the card's
  // own `relative z-10` sections create a stacking context, so the dialog's
  // z-index is scoped to that card and the NEXT card paints straight over it.
  // On screen the delivery chips of the neighbouring project showed through the
  // list of failures. A portal takes the dialog out of that context entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="pt-safe-dialog fixed inset-0 z-50 bg-black/80 p-3 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Data health for ${projectCode}`}
      onClick={onClose}
    >
      <section
        className="mx-auto flex max-h-full max-w-2xl flex-col rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border p-5">
          <div>
            <h2 className="font-mono text-lg font-semibold">{projectCode}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {trouble.length} process{trouble.length === 1 ? "" : "es"} needing attention, newest first.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
          >
            Close
          </button>
        </header>

        <ul className="flex flex-col divide-y divide-border overflow-y-auto">
          {trouble.map((bar, index) => (
            <li key={`${bar.at}-${index}`} className="px-5 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={bar.colour === "red" ? "text-danger" : "text-warn"}>●</span>
                <span className="font-mono text-[13px] font-medium">{bar.status}</span>
                <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                  {formatSgt(bar.at)} SGT
                </span>
              </div>
              {/* One line per thing the service complained about — WBGT writes
                  one per affected sensor, so these read as separate findings
                  rather than one run-on error. */}
              {bar.log.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                  {bar.log.map((line, lineIndex) => (
                    <li key={lineIndex} className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                // Said rather than left blank: "no reason recorded" is itself a
                // finding about the service, and several of them record none.
                <p className="mt-1 pl-4 text-[11px] italic text-muted-foreground opacity-70">
                  no reason recorded
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>,
    document.body,
  );
}
