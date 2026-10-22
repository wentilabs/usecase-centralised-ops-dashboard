"use client";

import { useEffect, useState } from "react";

import { SERVICE_SOURCES, TRANSPORT_LABEL } from "@/lib/source-model";
import type { VibrationSourceRow } from "@/lib/config-repository";

/**
 * Where a Vibration site's readings come from, as the first thing in its configuration.
 *
 * Noise has a "Upstream source" column to choose; Vibration does not, because a site has
 * no source of its own — each METER is bound to a source target, and the scraper reads the
 * targets. So this shows the real bindings (read from the view the scraper reads) instead
 * of a setting that would only be a label. Nothing here is editable and nothing is written.
 *
 * `sources` null means HALO could not read them, said as such: an empty list means no
 * meter is bound, and the two must never read the same.
 */
const UPSTREAM_LABEL: Record<string, string> = { protec: "PRO-TEC vibration monitor", wirs: "WIRS" };

export function VibrationSource({ code }: { code: string }) {
  const [sources, setSources] = useState<VibrationSourceRow[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/vibration/sources?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        const body = await res.json();
        if (!cancelled) setSources(Array.isArray(body.sources) ? body.sources : null);
      } catch {
        if (!cancelled) setSources(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const info = SERVICE_SOURCES.vibration;
  const hasProtec = Boolean(sources?.some((entry) => entry.source_type === "protec"));

  return (
    <section className="pt-5" data-vibration-source>
      <h3 className="mb-2 border-b border-border pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        Upstream source
      </h3>
      {sources === undefined ? (
        <p className="px-2 py-2 text-[12px] text-muted-foreground">Reading source targets…</p>
      ) : sources === null ? (
        <p className="px-2 py-2 text-[12px] text-warn">Could not read this site's source targets, so nothing is claimed about them.</p>
      ) : sources.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-warn">
          No source target is bound to {code}, so the scraper reads nothing for it. Prepare one in vibration_source_targets
          (prepared_project_code, prepared_meter_code).
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 px-2 py-1">
            {sources.map((entry) => (
              <li key={entry.source_key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
                <span className="w-12 font-mono font-semibold">{entry.meter_code}</span>
                <span>{UPSTREAM_LABEL[entry.source_type] ?? entry.source_type}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{entry.source_key}</span>
                <span className="text-[11px] text-muted-foreground">sign-in profile {entry.credential_profile}</span>
                {entry.enabled ? null : <span className="text-[11px] font-semibold text-warn">target disabled</span>}
                {entry.ppv_verified ? null : (
                  <span className="text-[11px] text-muted-foreground" title="The portal's PPV is kept as reported but not used for the common PPV field.">
                    PPV not verified
                  </span>
                )}
              </li>
            ))}
          </ul>
          {hasProtec ? (
            <div className="mt-2 flex flex-col gap-1 px-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">How it arrives · </span>
                {TRANSPORT_LABEL[info.transport]}. {info.how}
              </p>
              <p>
                <span className="font-semibold text-foreground">If it stops · </span>
                {info.breaks}
              </p>
            </div>
          ) : null}
        </>
      )}
      <p className="mt-2 px-2 text-[11px] text-muted-foreground">
        Not a setting: a site has no source of its own. Each meter is bound to a source target in the vibration repo. A
        meter is scraped only while the site (Project enabled, above) and its target are both enabled.
      </p>
    </section>
  );
}
