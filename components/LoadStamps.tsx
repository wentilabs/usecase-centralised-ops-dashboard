"use client";

import { describeLoad, type Load } from "@/lib/load-stamps";

/**
 * What has loaded, when, and how long it took.
 *
 * Inline and quiet, because it is a fact about the page and not a control. Each part names its own
 * state — "loading…" while it runs, the time and duration when it lands, "failed" if it did not — and
 * a failed one is red, so a card with no history can be told from a card whose history is still on its way.
 */
export function LoadStamps({ loads }: { loads: { label: string; load: Load; hint: string }[] }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2" aria-label="What has loaded, and when">
      {loads.map(({ label, load, hint }, index) => (
        <span key={label} className="inline-flex items-baseline gap-x-2">
          {/* A real separator, so a screen reader hears "…611 ms, health…" and not "611 mshealth". */}
          {index > 0 ? <span aria-hidden>·</span> : null}
          <span
            title={hint}
            className={load.state === "failed" ? "text-danger" : load.state === "loading" ? "animate-pulse" : ""}
          >
            {describeLoad(label, load)}
            <span className="sr-only">, </span>
          </span>
        </span>
      ))}
    </span>
  );
}
