import {
  DETECTION_CAP,
  EVIDENCE_BOX_FACTOR,
  EVIDENCE_CAP,
  countedTypes,
  evidenceFor,
  formatDistance,
  formatSgtClock,
  ringsFor,
  widestRingM,
} from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";
import type { DetectionPayload } from "./use-detections";

export function LightningEvidenceFooter({
  focus,
  evidence,
  error,
  loading,
  detectionsLength,
  view,
}: {
  focus: ProjectConfigRow | null;
  evidence: { payload: DetectionPayload; code: string } | null;
  error: string | null;
  loading: boolean;
  detectionsLength: number;
  view: DetectionPayload | null;
}) {
  const summary = evidence && focus && evidence.code === focus.project_code
    ? evidenceFor(focus, evidence.payload.detections)
    : null;
  const searchRadiusM = focus
    ? Math.max(1000, widestRingM(focus)) * EVIDENCE_BOX_FACTOR
    : 0;

  return (
    <footer className="shrink-0 space-y-1.5 border-t border-border px-3 pt-2 text-[11px] pb-safe md:px-4 md:py-2">
      {error ? <p className="text-danger">{error}</p> : null}
      {summary && focus && evidence ? (
        <p className="text-xs">
          <span className="font-semibold">{String(focus.project_code)}</span>{" "}
          {evidence.payload.truncated ? (
            <span className="text-warn">
              cannot be cleared for this window — the query hit its {EVIDENCE_CAP}-row cap with{" "}
              {evidence.payload.total} detections nearby, so anything earlier in the window was not read. Narrow
              the window and check again.
              {summary.red + summary.amber > 0
                ? ` (${summary.red} red and ${summary.amber} amber already found in what was read.)`
                : ""}
            </span>
          ) : summary.red === 0 && summary.amber === 0 ? (
            <span className="text-on">
              had no qualifying strike in this window — {summary.total === 0 ? "no" : summary.total}{" "}
              {countedTypes(focus).join("/")} detection{summary.total > 1 ? "s" : ""}{" "}
              {summary.total > 1 ? "were" : "was"} published anywhere in the {formatDistance(searchRadiusM)}{" "}
              searched around the site
              {summary.nearestM === null ? "" : `, closest ${formatDistance(summary.nearestM)}`}.
            </span>
          ) : (
            <span>
              had <span className="font-semibold text-danger">{summary.red} red</span> and{" "}
              <span className="font-semibold text-warn">{summary.amber} amber</span> qualifying strike
              {summary.red + summary.amber === 1 ? "" : "s"}, closest {formatDistance(summary.nearestM)}.
            </span>
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {focus
          ? ringsFor(focus).map((ring) => (
              <span
                key={`${ring.tier}-${ring.types}-${ring.radiusM}`}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  ring.tier === "red" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
                }`}
              >
                {ring.tier.toUpperCase()} {(ring.radiusM / 1000).toFixed(ring.radiusM % 1000 ? 2 : 0)} km ·{" "}
                {ring.types}
              </span>
            ))
          : null}
        {focus && !ringsFor(focus).length ? (
          <span className="text-warn">No ring is being evaluated for this project.</span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full border border-[#5c3c05] bg-[#c8860d]" /> G — cloud-to-ground
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full border border-[#1e40af] bg-[#93c5fd]" /> C — intra-cloud
        </span>
        <span className="hidden items-center gap-1 md:inline-flex">
          <span className="h-2 w-3 rounded-sm border border-[#f87171] bg-[#f87171]/20" /> red ring
        </span>
        <span className="hidden items-center gap-1 md:inline-flex">
          <span className="h-2 w-3 rounded-sm border border-[#fbbf24] bg-[#fbbf24]/20" /> amber ring
        </span>
        <span className="hidden md:inline">faded = earlier in the window</span>
        <span className="ml-auto font-mono">
          {loading ? "loading…" : `${detectionsLength} shown`}
          {view && view.total > detectionsLength ? ` of ${view.total} (cap ${DETECTION_CAP} — zoom in)` : ""}
          {view ? ` · ${formatSgtClock(view.from)} → ${formatSgtClock(view.to)} SGT` : ""}
        </span>
      </div>
      <p className="hidden text-[10px] text-muted-foreground md:block">
        Windows filter on when NEA published a detection, not when it struck. Rings include site extent and type
        uncertainty, so they are the distances that actually trigger an alert.
      </p>
    </footer>
  );
}
