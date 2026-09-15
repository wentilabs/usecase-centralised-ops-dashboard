"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLightningCanvas } from "@/components/lightning-map/use-canvas";
import { useLightningDetections } from "@/components/lightning-map/use-detections";
import { useLightningGestures } from "@/components/lightning-map/use-gestures";
import {
  DETECTION_CAP,
  EVIDENCE_BOX_FACTOR,
  EVIDENCE_CAP,
  WINDOWS,
  countedTypes,
  evidenceFor,
  formatDistance,
  formatSgtClock,
  haversineMetres,
  publishLagSeconds,
  ringsFor,
  sgtInputToMs,
  sgtInputValue,
  widestRingM,
  type WindowKey,
} from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  SG_CENTRE,
  TILE_ATTRIBUTION,
  TILE_WATER,
  boundsAspect,
  clampCentre,
  fitZoom,
  tileSrc,
  tilesForViewport,
} from "@/lib/slippy-map";
import { useBodyScrollLock, useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * The Singapore lightning map — evidence, not a dashboard.
 *
 * It exists to settle one kind of conversation: a client says there was
 * lightning overhead and asks why no alert came. The map puts NEA's own
 * detections and the project's actual trigger rings on the same picture, at a
 * time the operator chooses, so the answer is something you can point at.
 *
 * Three decisions follow from that purpose and should survive any redesign:
 *
 * - **The window filters on publish time, not strike time.** A strike NEA told
 *   us about at 23:58 could not have fired a 23:52 alert, and a map filtered on
 *   strike time would show it as though it could. Both stamps are on the
 *   tooltip, and the lag between them is usually two to four minutes.
 * - **The rings are the engine's rings**, widened by site extent and type
 *   uncertainty, not the raw radius columns — see `ringsFor`.
 * - **The counts a client sees come from their own query**, not from whatever
 *   the canvas happens to be drawing. See `evidence` below.
 *
 * Read-only throughout: nothing here can change a configuration.
 */

export function LightningMap({
  projects,
  initialFocus,
  onClose,
}: {
  projects: ProjectConfigRow[];
  initialFocus?: string | null;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);
  // The map covers the whole screen and owns the wheel for zooming, so the
  // dashboard behind it must not scroll underneath — otherwise closing the map
  // leaves you somewhere else in the list than where you opened it.
  useBodyScrollLock(true);

  // Only sited projects can be drawn. A lightning project without coordinates is
  // a configuration problem, but it is not this screen's problem to report.
  const sited = useMemo(
    () =>
      projects.filter(
        (row) =>
          Number.isFinite(Number(row.latitude)) &&
          Number.isFinite(Number(row.longitude)),
      ),
    [projects],
  );

  const [focusCode, setFocusCode] = useState<string | null>(
    initialFocus ?? null,
  );
  const focus = useMemo(
    () => sited.find((row) => row.project_code === focusCode) ?? null,
    [sited, focusCode],
  );

  const [windowKey, setWindowKey] = useState<WindowKey>("1h");
  /** null means "now", and keeps refreshing. A number pins the map to an instant. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [centre, setCentre] = useState(() => {
    const start = initialFocus
      ? projects.find((row) => row.project_code === initialFocus)
      : null;
    return start && Number.isFinite(Number(start.latitude))
      ? { latitude: Number(start.latitude), longitude: Number(start.longitude) }
      : SG_CENTRE;
  });
  const [zoom, setZoom] = useState(initialFocus ? 14 : MIN_ZOOM);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { at, view, evidence, loading, error, refresh } = useLightningDetections({
    centre,
    zoom,
    size,
    windowKey,
    anchor,
    focus,
  });

  /**
   * The map box is cut to Singapore's own proportions, so the whole island
   * fills it exactly at this zoom — there is no view worth showing further out,
   * and allowing one would only add water. Replaces the fixed MIN_ZOOM, which
   * was right for one screen size and arbitrary on every other.
   */
  const minZoom = fitZoom(size.width, size.height);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);

  /** The space the map is centred in. The map itself is cut to fit it. */
  const frame = useRef<HTMLDivElement | null>(null);
  /** Read by handlers that must not re-subscribe on every render. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      // The map is cut to Singapore's shape, but only by capping its *width*.
      //
      // A desktop window is nearer 2:1 and the island about 1.55:1, so filling
      // the width left wide bands of open water; the cap letterboxes those away.
      // A phone is the other way round, and applying the same ratio to a tall
      // frame would have given a 375×241 map with two thirds of the screen
      // empty — so the height always takes what it is given, and the surplus is
      // sea, which is seamless now the ground is painted in OneMap's water.
      //
      // Computed here rather than left to CSS `aspect-ratio`, which a sibling
      // `h-full` silently overrides, and because the projection needs these as
      // numbers anyway — CSS would only be a second source of truth.
      const aspect = boundsAspect();
      // `clientWidth`/`clientHeight` include padding, so the frame's own inset
      // has to come off or the map is sized to overflow the box it sits in.
      const style = getComputedStyle(element);
      const available = {
        width:
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        height:
          element.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      };
      const next = {
        width: Math.floor(Math.min(available.width, available.height * aspect)),
        height: Math.floor(available.height),
      };
      setSize(next);
      const floor = fitZoom(next.width, next.height);
      const z = Math.max(floor, zoomRef.current);
      if (z !== zoomRef.current) setZoom(z);
      setCentre((point) => clampCentre(point, z, next.width, next.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const detections = view?.detections ?? [];

  const { canvas, plotted } = useLightningCanvas({
    detections,
    sited,
    centre,
    zoom,
    size,
    focus,
    view,
  });

  const { box, onPointerDown, onPointerMove, onPointerEnd, focusOn, step } =
    useLightningGestures({
      plotted,
      centre,
      setCentre,
      zoom,
      setZoom,
      size,
      minZoom,
      setHover,
      setFocusCode,
    });

  /**
   * Tiles exist only at whole zoom levels, but zoom here is continuous.
   *
   * So the grid is built for the nearest whole level and the layer is then
   * scaled by the difference. During a pinch that means the pixels already on
   * screen stretch under the fingers immediately, and a fresh tile set is only
   * fetched when the gesture crosses into a new level — which is what makes
   * this feel like a map rather than a slideshow.
   *
   * `tileScale` stays within [1/√2, √2] because the level is rounded, so the
   * stretch is never visible enough to look soft.
   */
  const tileZoom = Math.max(0, Math.min(MAX_ZOOM, Math.round(zoom)));
  const tileScale = 2 ** (zoom - tileZoom);
  // The layer is laid out at its own unscaled size and then scaled up to fill
  // the box, so the grid still has to cover the whole viewport afterwards.
  const layer = {
    width: size.width / tileScale,
    height: size.height / tileScale,
  };
  const tiles =
    size.width > 0
      ? tilesForViewport(centre, tileZoom, layer.width, layer.height)
      : [];
  // `ordered` in the draw pass is what `plotted` indexes, so the tooltip has to
  // read from the same ordering or it would describe a different strike.
  const orderedForHover = useMemo(
    () =>
      [...detections].sort(
        (a, b) =>
          (a.published_at ?? a.occurred_at) - (b.published_at ?? b.occurred_at),
      ),
    [detections],
  );
  const hovered = hover ? orderedForHover[hover.index] : null;

  const summary =
    evidence && focus && evidence.code === focus.project_code
      ? evidenceFor(focus, evidence.payload.detections)
      : null;
  /**
   * How far out the evidence query actually looked.
   *
   * Not a threshold — it is the widest ring the project runs, times
   * `EVIDENCE_BOX_FACTOR`. A 6 km amber ring searches 7.5 km, and the margin
   * exists so "closest strike" still has something to report when nothing came
   * near the ring itself. Quoted in the sentence because a distance with no
   * stated origin invites exactly the question of where it came from, and
   * because it is the honest bound on the claim: nothing beyond it was checked.
   *
   * Built from the same expression as the query, so the two cannot disagree.
   */
  const searchRadiusM = focus
    ? Math.max(1000, widestRingM(focus)) * EVIDENCE_BOX_FACTOR
    : 0;

  const zoomControl = (
    <>
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= minZoom}
        onClick={() => step(-1)}
        className="h-9 w-9 rounded-lg border border-border bg-card/90 text-base shadow-soft backdrop-blur disabled:opacity-40 md:h-8 md:w-8 md:bg-transparent md:text-sm md:shadow-none md:backdrop-blur-none"
      >
        −
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => step(1)}
        className="h-9 w-9 rounded-lg border border-border bg-card/90 text-base shadow-soft backdrop-blur disabled:opacity-40 md:h-8 md:w-8 md:bg-transparent md:text-sm md:shadow-none md:backdrop-blur-none"
      >
        +
      </button>
    </>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* One row on a desktop. On a phone the controls take their own line and
          scroll sideways: stacked, they cost 320px of an 812px screen and left
          the map a strip. `order` keeps Close beside the title there without a
          second copy of the button. */}
      {/*
        One row on a desktop; two proper rows on a phone.

        The phone used to get the desktop row squeezed into a sideways-scrolling
        rail, which put Close under the iPhone status bar and left the date
        control half off the right edge with nothing to say it was there. Rows
        that fit are better than a rail nobody knows to scroll.

        `pt-safe` is why the status bar no longer eats the Close button: the
        overlay is `fixed inset-0`, so without it the first row starts at the
        physical top of the screen, behind the notch. Every other overlay in the
        app already used this helper — this one had simply never been told.
      */}
      <header className="shrink-0 border-b border-border px-3 pb-2 pt-safe md:flex md:flex-wrap md:items-center md:gap-2 md:px-4 md:py-2">
        <div className="flex items-center gap-2 md:mr-auto md:contents">
          <div className="mr-auto flex items-baseline gap-2 md:mr-auto">
            <h2 className="text-sm font-semibold">Singapore lightning map</h2>
            <span className="hidden text-[11px] text-muted-foreground lg:inline">
              NEA detections, by the time they reached us
            </span>
          </div>
          {/* Thumb-sized on a phone, and first in the DOM so it is also the
              first thing a screen reader reaches after the title. */}
          <button
            type="button"
            onClick={onClose}
            className="h-9 shrink-0 rounded-lg border border-border px-3 text-xs hover:border-danger hover:text-danger md:order-last md:h-8"
          >
            Close
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 md:mt-0 md:contents">
          <select
            value={focusCode ?? ""}
            onChange={(event) => {
              const code = event.target.value;
              focusOn(
                code
                  ? (sited.find((row) => row.project_code === code) ?? null)
                  : null,
              );
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs md:h-8 md:flex-none"
          >
            <option value="">All {sited.length} projects</option>
            {sited.map((row) => (
              <option
                key={String(row.project_code)}
                value={String(row.project_code)}
              >
                {String(row.project_code)}
              </option>
            ))}
          </select>

          {/* The anchor is the END of the window, in Singapore time whatever the
              phone is set to — see `sgtInputToMs`. */}
          <input
            type="datetime-local"
            value={sgtInputValue(anchor ?? view?.to ?? Date.now())}
            onChange={(event) => setAnchor(sgtInputToMs(event.target.value))}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs md:h-8 md:flex-none"
            aria-label="End of window, Singapore time"
          />
        </div>

        <div className="mt-2 flex items-center gap-2 md:mt-0 md:contents">
          <div className="flex flex-1 overflow-hidden rounded-lg border border-border md:flex-none">
            {WINDOWS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setWindowKey(entry.key)}
                className={`flex-1 px-2.5 py-2 text-xs md:flex-none md:py-1.5 ${
                  windowKey === entry.key
                    ? "bg-primary/20 text-primary"
                    : "hover:bg-muted/40"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setAnchor(null);
              refresh();
            }}
            className={`h-9 shrink-0 rounded-lg border px-3 text-xs md:h-8 md:px-2.5 ${
              anchor === null
                ? "border-on/40 bg-on/10 text-on"
                : "border-border bg-card hover:border-primary hover:text-primary"
            }`}
            title={
              anchor === null
                ? "Following the clock, refreshing every minute"
                : "Jump back to now"
            }
          >
            {anchor === null ? "● Live" : "Now"}
          </button>

          {/* Desktop keeps its zoom buttons in the header, where there is room
              for them. A phone gets them floated on the map instead — see
              below — because a phone pinches, and a header row spent on two
              small buttons is a row not spent on the map. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex">
            {zoomControl}
          </div>
        </div>
      </header>

      {/* The map is cut to Singapore's own proportions and centred, rather than
          stretched to whatever shape the window is. The island is about 1.55:1,
          a desktop window nearer 2:1, and filling the width left wide bands of
          open water with nothing in them. Letterboxing to the real shape means
          every pixel of the map is somewhere a project could be. */}
      <div
        ref={frame}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 md:p-3"
      >
        <div
          ref={box}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={() => setHover(null)}
          className="relative cursor-grab overflow-hidden rounded-lg border border-border shadow-soft active:cursor-grabbing"
          style={{
            // `touchAction: none` also stops the browser claiming the gesture on
            // a touchscreen, which is the same problem the non-passive wheel
            // listener solves for a trackpad.
            touchAction: "none",
            // OneMap's own water, so where its coverage stops the map simply
            // keeps being sea rather than turning into a dark rectangle.
            background: TILE_WATER,
            width: size.width || undefined,
            height: size.height || undefined,
          }}
        >
          {/* Scaled about the centre, which is the same point the projection
              measures from, so tiles and canvas stay registered mid-gesture. */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{
              width: layer.width,
              height: layer.height,
              transform: `translate(-50%, -50%) scale(${tileScale})`,
              transformOrigin: "center",
            }}
          >
            {tiles.map((tile) => (
              <img
                key={`${tile.z}/${tile.x}/${tile.y}`}
                src={tileSrc(tile)}
                alt=""
                aria-hidden="true"
                draggable={false}
                width={256}
                height={256}
                // OneMap serves Singapore and nothing else, so a tile beyond the
                // coastline 404s and the browser paints its own broken-image icon.
                // Hiding the element is the whole fix; the map is clamped to the
                // covered area anyway, and this catches the edges of it.
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden";
                }}
                onLoad={(event) => {
                  event.currentTarget.style.visibility = "visible";
                }}
                className="pointer-events-none absolute select-none"
                style={{ left: tile.left, top: tile.top }}
              />
            ))}
          </div>

          <canvas
            ref={canvas}
            className="pointer-events-none absolute inset-0"
            style={{ width: size.width, height: size.height }}
          />

          {hovered && hover ? (
            <div
              className="pointer-events-none absolute z-10 w-[200px] rounded-lg border border-border bg-card/95 p-2 text-[11px] shadow-soft"
              // Flipped to the other side near the right or bottom edge, so a
              // strike at the edge of the map is still readable.
              style={{
                left: Math.min(hover.x + 12, size.width - 210),
                top: hover.y > size.height - 130 ? hover.y - 122 : hover.y + 12,
              }}
            >
              <div className="font-semibold">
                {hovered.detection_type === "G"
                  ? "⚡ Cloud-to-ground (G)"
                  : "○ Intra-cloud (C)"}
              </div>
              <dl className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <dt>struck</dt>
                  <dd>{formatSgtClock(hovered.occurred_at)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>published</dt>
                  <dd>{formatSgtClock(hovered.published_at)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>lag</dt>
                  <dd>
                    {publishLagSeconds(hovered) === null
                      ? "—"
                      : `${publishLagSeconds(hovered)}s`}
                  </dd>
                </div>
                {focus ? (
                  <div className="flex justify-between gap-2 text-foreground">
                    <dt>from {String(focus.project_code)}</dt>
                    <dd>
                      {formatDistance(
                        haversineMetres(
                          {
                            lat: Number(focus.latitude),
                            lon: Number(focus.longitude),
                          },
                          { lat: hovered.latitude, lon: hovered.longitude },
                        ),
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {/* Phone-only, over the map in the corner a thumb reaches. Pinch is
              the main gesture there; these are for the last small adjustment. */}
          <div className="absolute bottom-7 right-2 flex flex-col gap-1.5 md:hidden">
            {zoomControl}
          </div>

          <div className="pointer-events-none absolute bottom-0 right-0 bg-card/80 px-1 text-[9px] text-muted-foreground">
            {TILE_ATTRIBUTION}
          </div>
        </div>
      </div>

      <footer className="shrink-0 space-y-1.5 border-t border-border px-3 pt-2 text-[11px] pb-safe md:px-4 md:py-2">
        {error ? <p className="text-danger">{error}</p> : null}

        {summary && focus ? (
          <p className="text-xs">
            {/* The claim, in one sentence, phrased so it can be read out. */}
            <span className="font-semibold">
              {String(focus.project_code)}
            </span>{" "}
            {evidence?.payload.truncated ? (
              // An all-clear from a truncated read is a false statement, not a
              // hedged one. When the query hit its cap the panel says only what
              // it actually saw, and asks for a narrower window.
              <span className="text-warn">
                cannot be cleared for this window — the query hit its{" "}
                {EVIDENCE_CAP}-row cap with {evidence.payload.total} detections
                nearby, so anything earlier in the window was not read. Narrow
                the window and check again.
                {summary.red + summary.amber > 0
                  ? ` (${summary.red} red and ${summary.amber} amber already found in what was read.)`
                  : ""}
              </span>
            ) : summary.red === 0 && summary.amber === 0 ? (
              <span className="text-on">
                had no qualifying strike in this window —{" "}
                {summary.total === 0 ? "no" : summary.total}{" "}
                {countedTypes(focus).join("/")} detection
                {summary.total > 1 ? "s" : ""}{" "}
                {summary.total > 1 ? "were" : "was"} published anywhere in the{" "}
                {formatDistance(searchRadiusM)} searched around the site
                {summary.nearestM === null
                  ? ""
                  : `, closest ${formatDistance(summary.nearestM)}`}
                .
              </span>
            ) : (
              <span>
                had{" "}
                <span className="font-semibold text-danger">
                  {summary.red} red
                </span>{" "}
                and{" "}
                <span className="font-semibold text-warn">
                  {summary.amber} amber
                </span>{" "}
                qualifying strike{summary.red + summary.amber === 1 ? "" : "s"},
                closest {formatDistance(summary.nearestM)}.
              </span>
            )}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {/* The focused project's rings in words. The on-canvas labels can be
              pushed out of view by a ring wider than the map; this row cannot,
              so "does this ring count intra-cloud" always has an answer. */}
          {focus
            ? ringsFor(focus).map((ring) => (
                <span
                  key={`${ring.tier}-${ring.types}-${ring.radiusM}`}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                    ring.tier === "red"
                      ? "bg-danger/10 text-danger"
                      : "bg-warn/10 text-warn"
                  }`}
                >
                  {ring.tier.toUpperCase()}{" "}
                  {(ring.radiusM / 1000).toFixed(ring.radiusM % 1000 ? 2 : 0)}{" "}
                  km · {ring.types}
                </span>
              ))
            : null}
          {focus && !ringsFor(focus).length ? (
            <span className="text-warn">
              No ring is being evaluated for this project.
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border border-[#5c3c05] bg-[#c8860d]" />{" "}
            G — cloud-to-ground
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border border-[#1e40af] bg-[#93c5fd]" />{" "}
            C — intra-cloud
          </span>
          {/* The ring swatches restate what the RED/AMBER chips above already
              say, so the phone drops them rather than spending a line. */}
          <span className="hidden items-center gap-1 md:inline-flex">
            <span className="h-2 w-3 rounded-sm border border-[#f87171] bg-[#f87171]/20" />{" "}
            red ring
          </span>
          <span className="hidden items-center gap-1 md:inline-flex">
            <span className="h-2 w-3 rounded-sm border border-[#fbbf24] bg-[#fbbf24]/20" />{" "}
            amber ring
          </span>
          <span className="hidden md:inline">
            faded = earlier in the window
          </span>
          <span className="ml-auto font-mono">
            {loading ? "loading…" : `${detections.length} shown`}
            {view && view.total > detections.length
              ? ` of ${view.total} (cap ${DETECTION_CAP} — zoom in)`
              : ""}
            {view
              ? ` · ${formatSgtClock(view.from)} → ${formatSgtClock(view.to)} SGT`
              : ""}
          </span>
        </div>

        {/* Rings are the engine's, not the raw columns. Said out loud because the
            difference is invisible today — every project runs zero margins — and
            would otherwise look like a bug the first time someone sets one. */}
        <p className="hidden text-[10px] text-muted-foreground md:block">
          Windows filter on when NEA published a detection, not when it struck.
          Rings include site extent and type uncertainty, so they are the
          distances that actually trigger an alert.
        </p>
      </footer>
    </div>
  );
}
