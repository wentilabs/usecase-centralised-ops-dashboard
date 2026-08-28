"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DETECTION_CAP,
  EVIDENCE_BOX_FACTOR,
  EVIDENCE_CAP,
  WINDOWS,
  boxContains,
  countedTypes,
  boundsAround,
  evidenceFor,
  formatDistance,
  formatSgtClock,
  haversineMetres,
  hitTest,
  publishLagSeconds,
  qualifies,
  radiusPixels,
  ringsFor,
  screenPoint,
  sgtInputToMs,
  sgtInputValue,
  viewportBounds,
  widestRingM,
  type Box,
  type Detection,
  type WindowKey,
} from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  SG_CENTRE,
  TILE_ATTRIBUTION,
  TILE_WATER,
  WHEEL_PER_ZOOM,
  clampCentre,
  classifyWheel,
  clampZoom,
  panCentre,
  pointAtOffset,
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

const RED = { stroke: "248, 113, 113", fill: "248, 113, 113" };
const AMBER = { stroke: "251, 191, 36", fill: "251, 191, 36" };

/**
 * Strike pins. Cloud-to-ground is the type that hurts people, so it takes the
 * heavier brown-gold; intra-cloud takes a light blue that recedes. The letter
 * is the actual guarantee — colour alone fails for anyone who cannot separate
 * these two hues.
 */
const PIN_G = { fill: "#c8860d", edge: "#5c3c05", ink: "#fffbeb" };
const PIN_C = { fill: "#93c5fd", edge: "#1e40af", ink: "#0b2559" };

/** Pin head radius, and how far above its tip the head sits. */
const PIN_R = 8;
const PIN_LIFT = 12;

/** Zoom at which a project earns its code label. Below it, 28 labels is soup. */
const LABEL_ZOOM = 12;

type Payload = {
  from: number;
  to: number;
  total: number;
  truncated: boolean;
  detections: Detection[];
};

async function fetchDetections(params: {
  at: number;
  window: WindowKey;
  bbox?: { south: number; west: number; north: number; east: number };
  types?: string[];
  limit?: number;
  signal: AbortSignal;
}): Promise<Payload> {
  const query = new URLSearchParams({ at: String(params.at), window: params.window });
  if (params.limit) query.set("limit", String(params.limit));
  if (params.types?.length) query.set("types", params.types.join(","));
  if (params.bbox) {
    const { south, west, north, east } = params.bbox;
    query.set("bbox", [south, west, north, east].map((value) => value.toFixed(5)).join(","));
  }
  const response = await fetch(`/api/lightning/detections?${query}`, { signal: params.signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body as Payload;
}

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
    () => projects.filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))),
    [projects],
  );

  const [focusCode, setFocusCode] = useState<string | null>(initialFocus ?? null);
  const focus = useMemo(
    () => sited.find((row) => row.project_code === focusCode) ?? null,
    [sited, focusCode],
  );

  const [windowKey, setWindowKey] = useState<WindowKey>("1h");
  /** null means "now", and keeps refreshing. A number pins the map to an instant. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  /**
   * "Now", resolved once per refresh rather than once per request.
   *
   * Both layers used to call `Date.now()` inside their own fetch, which left
   * them describing windows a second apart — enough for the map and the
   * evidence sentence to disagree about a strike on the boundary, which is
   * precisely the strike anyone would be arguing about.
   */
  const [liveAt, setLiveAt] = useState(() => Date.now());
  useEffect(() => {
    if (anchor === null) setLiveAt(Date.now());
  }, [anchor, tick]);
  const at = anchor ?? liveAt;

  const [centre, setCentre] = useState(() => {
    const start = initialFocus ? projects.find((row) => row.project_code === initialFocus) : null;
    return start && Number.isFinite(Number(start.latitude))
      ? { latitude: Number(start.latitude), longitude: Number(start.longitude) }
      : SG_CENTRE;
  });
  const [zoom, setZoom] = useState(initialFocus ? 14 : MIN_ZOOM);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [view, setView] = useState<Payload | null>(null);
  const [evidence, setEvidence] = useState<{ payload: Payload; code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  const box = useRef<HTMLDivElement | null>(null);
  /** Read by the resize handler, which must not re-subscribe on every zoom. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** Where each drawn strike landed, so the pointer can be matched to one. */
  const plotted = useRef<{ x: number; y: number }[]>([]);
  /**
   * The box the last complete map fetch covered, and the query it answered.
   * A pan or zoom that stays inside it needs no request — see `boxContains`.
   */
  const held = useRef<{ box: Box; window: WindowKey; at: number } | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize(next);
      setCentre((point) => clampCentre(point, zoomRef.current, next.width, next.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Live mode re-asks once a minute. Detections publish two to four minutes
  // after the strike, so anything faster would mostly redraw the same picture.
  useEffect(() => {
    if (anchor !== null) return;
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [anchor]);

  /**
   * The map layer: whatever is in view, capped.
   *
   * Debounced because panning and zooming change the box continuously, and each
   * intermediate frame would otherwise be a query. 160ms against a query that
   * measures around 100ms: long enough to coalesce a drag, short enough that
   * releasing the map feels like it had already loaded.
   */
  useEffect(() => {
    if (size.width === 0) return;
    const bbox = viewportBounds(centre, zoom, size.width, size.height);

    // Already held, in full, for this same question: redraw and skip the round
    // trip. Zooming in and small pans land here, which is most of the
    // interaction once someone is looking at one site.
    const cached = held.current;
    if (
      cached &&
      cached.window === windowKey &&
      cached.at === at &&
      boxContains(cached.box, bbox)
    ) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetchDetections({
        at,
        window: windowKey,
        bbox,
        signal: controller.signal,
      })
        .then((payload) => {
          // Only an untruncated result covers its box; a capped one is a
          // sample, and reusing it while panning would quietly lose strikes.
          held.current = payload.truncated ? null : { box: bbox, window: windowKey, at };
          setView(payload);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [centre, zoom, size.width, size.height, windowKey, at]);

  /**
   * The evidence layer: a second, tight query around the focused project.
   *
   * Deliberately not derived from the map layer. That one is capped at 500 and
   * bounded by wherever the operator panned, so counting hits from it would
   * produce a number that changes when you scroll — and this number is the one
   * that gets read out to a client. A box a few kilometres wide effectively
   * never reaches the cap, and `truncated` is surfaced if it somehow does.
   */
  useEffect(() => {
    if (!focus) {
      setEvidence(null);
      return;
    }
    const controller = new AbortController();
    const radius = Math.max(1000, widestRingM(focus));

    fetchDetections({
      at,
      window: windowKey,
      // Only a little wider than the widest ring: enough that "nearest strike"
      // has something to report when nothing came close, and tight enough that
      // a busy hour still fits under the cap. A box three times the ring did
      // not, and the panel then declared an all-clear over a strike it had
      // simply not fetched.
      bbox: boundsAround(
        { latitude: Number(focus.latitude), longitude: Number(focus.longitude) },
        radius * EVIDENCE_BOX_FACTOR,
      ),
      // Only the types this project's tiers count. Everything else is noise
      // that can only push a qualifying strike out of a capped result.
      types: countedTypes(focus),
      limit: EVIDENCE_CAP,
      signal: controller.signal,
    })
      .then((payload) => setEvidence({ payload, code: String(focus.project_code) }))
      .catch(() => {
        if (!controller.signal.aborted) setEvidence(null);
      });
    return () => controller.abort();
  }, [focus, windowKey, at]);

  const detections = view?.detections ?? [];

  /** Draw. Rings underneath, strikes on top, oldest first so recent wins overlap. */
  useEffect(() => {
    const element = canvas.current;
    if (!element || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = size.width * ratio;
    element.height = size.height * ratio;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    // Where ring labels have already been placed, so two clamped to the same
    // corner do not print on top of each other — which they did whenever both
    // rings were wider than the viewport.
    const labelled: { x: number; y: number; w: number }[] = [];

    /**
     * Rings, shaded rather than outlined.
     *
     * The fills are composited through one offscreen layer per tier instead of
     * being painted straight onto the canvas. Twenty-eight translucent discs
     * drawn directly compound wherever they overlap, and at island zoom that
     * turned the map into one orange mass with no coastline left. Drawing each
     * tier opaque into its own layer and then compositing that layer once gives
     * the union of the rings at a single, predictable alpha — overlap reads as
     * one shaded area, which is what it is.
     */
    const shade = (
      tier: "red" | "amber",
      alpha: number,
      pick: (project: ProjectConfigRow) => boolean = () => true,
    ) => {
      const layer = document.createElement("canvas");
      layer.width = element.width;
      layer.height = element.height;
      const lctx = layer.getContext("2d");
      if (!lctx) return;
      lctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      lctx.fillStyle = `rgb(${(tier === "red" ? RED : AMBER).fill})`;

      let drew = false;
      for (const project of sited.filter(pick)) {
        const latitude = Number(project.latitude);
        const point = screenPoint(
          { latitude, longitude: Number(project.longitude) },
          centre,
          zoom,
          size.width,
          size.height,
        );
        for (const ring of ringsFor(project).filter((entry) => entry.tier === tier)) {
          const pixels = radiusPixels(ring.radiusM, latitude, zoom);
          if (
            point.x + pixels < 0 ||
            point.x - pixels > size.width ||
            point.y + pixels < 0 ||
            point.y - pixels > size.height
          ) {
            continue;
          }
          lctx.beginPath();
          lctx.arc(point.x, point.y, pixels, 0, Math.PI * 2);
          lctx.fill();
          drew = true;
        }
      }
      if (!drew) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    // Amber first, so red sits on top of the wider amber area it lies inside.
    //
    // The passes are mutually exclusive by project, not stacked: shading
    // everything and then shading the focused project again on top put four
    // layers over the same pixels and took the red interior to roughly 0.44,
    // which buried the basemap it is drawn over.
    const isFocused = (project: ProjectConfigRow) =>
      Boolean(focus) && project.project_code === focus?.project_code;
    const others = (project: ProjectConfigRow) => !isFocused(project);

    if (focus) {
      // The unfocused rings drop to almost nothing. Their job is to say "other
      // sites exist here", and any more than that competes with the one being
      // asked about — which is what makes the selected area obvious, more than
      // darkening the selection would.
      shade("amber", 0.03, others);
      shade("red", 0.035, others);
      shade("amber", 0.09, isFocused);
      shade("red", 0.1, isFocused);
    } else {
      shade("amber", 0.09);
      shade("red", 0.11);
    }

    // Outlines and labels on top of the shading.
    for (const project of sited) {
      const latitude = Number(project.latitude);
      const longitude = Number(project.longitude);
      const point = screenPoint({ latitude, longitude }, centre, zoom, size.width, size.height);
      const isFocus = !focus || project.project_code === focus.project_code;
      const rings = ringsFor(project);

      for (const tier of ["amber", "red"] as const) {
        for (const ring of rings.filter((entry) => entry.tier === tier)) {
          const pixels = radiusPixels(ring.radiusM, latitude, zoom);
          if (
            point.x + pixels < 0 ||
            point.x - pixels > size.width ||
            point.y + pixels < 0 ||
            point.y - pixels > size.height
          ) {
            continue;
          }
          const colour = tier === "red" ? RED : AMBER;
          ctx.beginPath();
          ctx.arc(point.x, point.y, pixels, 0, Math.PI * 2);
          // The edge carries the meaning — inside it an alert fires, outside it
          // does not — so it is the part that gets weight, and the fill can stay
          // light enough to read the streets underneath.
          ctx.strokeStyle = `rgba(${colour.stroke}, ${focus ? (isFocus ? 0.95 : 0.28) : 0.7})`;
          ctx.lineWidth = focus && isFocus ? 3 : 1.6;
          ctx.stroke();

          // The types a ring governs are labelled on the ring itself, and only
          // for the focused project: a circle that ignores intra-cloud strikes
          // must not be mistaken for one that catches them.
          if (focus && project.project_code === focus.project_code && pixels > 34) {
            const text = `${tier.toUpperCase()} ${(ring.radiusM / 1000).toFixed(ring.radiusM % 1000 ? 1 : 0)}km · ${ring.types}`;
            ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
            const width = ctx.measureText(text).width;

            // The label rides the top of its circle — but a ring wider than the
            // viewport has no visible top, which silently hid every label on a
            // focused project (a 3km ring at zoom 14 is taller than the map).
            // So slide it down the arc to where the circle first enters view.
            let labelX = point.x;
            let labelY = point.y - pixels;
            if (labelY < 14) {
              labelY = 14;
              const across = pixels ** 2 - (point.y - labelY) ** 2;
              // No intersection means the circle misses the top edge entirely;
              // the label would then float over open map, so it is dropped.
              if (across <= 0) continue;
              labelX = point.x + Math.sqrt(across);
            }
            labelX = Math.min(Math.max(labelX, width / 2 + 6), size.width - width / 2 - 6);
            while (
              labelled.some(
                (placed) =>
                  Math.abs(placed.y - labelY) < 15 && Math.abs(placed.x - labelX) < (placed.w + width) / 2 + 6,
              )
            ) {
              labelY += 16;
            }
            if (labelY > size.height - 6) continue;
            labelled.push({ x: labelX, y: labelY, w: width });

            ctx.fillStyle = "rgba(10, 12, 16, 0.78)";
            ctx.fillRect(labelX - width / 2 - 4, labelY - 8, width + 8, 14);
            ctx.fillStyle = `rgb(${colour.stroke})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, labelX, labelY - 1);
          }
        }
      }
    }

    // Project pins, drawn after every ring so no ring fill washes one out.
    for (const project of sited) {
      const point = screenPoint(
        { latitude: Number(project.latitude), longitude: Number(project.longitude) },
        centre,
        zoom,
        size.width,
        size.height,
      );
      if (point.x < -60 || point.x > size.width + 60 || point.y < -30 || point.y > size.height + 30) continue;
      const isFocus = !focus || project.project_code === focus.project_code;

      ctx.beginPath();
      ctx.arc(point.x, point.y, isFocus ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isFocus ? "#e2e8f0" : "rgba(226, 232, 240, 0.45)";
      ctx.fill();
      ctx.strokeStyle = "rgba(10, 12, 16, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (zoom >= LABEL_ZOOM || (focus && project.project_code === focus.project_code)) {
        const text = String(project.project_code ?? "");
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(10, 12, 16, 0.8)";
        ctx.fillRect(point.x + 7, point.y - 8, width + 7, 15);
        ctx.fillStyle = isFocus ? "#f1f5f9" : "rgba(241, 245, 249, 0.6)";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(text, point.x + 10.5, point.y);
      }
    }

    /**
     * Strikes, as map pins with their type written on them.
     *
     * They were 3px dots, distinguished by fill versus outline, and at a glance
     * a sky full of harmless intra-cloud flashes looked the same as a sky full
     * of ground strikes. A pin with a letter in it cannot be misread, and it
     * points at its own coordinate rather than covering it.
     *
     * Oldest first, so the most recent sit on top of a dense cluster.
     */
    const span = view ? Math.max(1, view.to - view.from) : 1;
    const positions: { x: number; y: number }[] = [];
    const ordered = [...detections].sort(
      (a, b) => (a.published_at ?? a.occurred_at) - (b.published_at ?? b.occurred_at),
    );

    for (const detection of ordered) {
      const point = screenPoint(detection, centre, zoom, size.width, size.height);
      // The pin's tip marks the strike; its head sits above. Hit-testing uses
      // the head, because that is the part the pointer can actually land on.
      const head = { x: point.x, y: point.y - PIN_LIFT };
      positions.push(head);
      if (point.x < -20 || point.x > size.width + 20 || point.y < -30 || point.y > size.height + 20) continue;

      // Older strikes fade, so a storm crossing the island reads as a direction
      // of travel. The floor is high enough that an old pin is still legible —
      // it is evidence, not decoration.
      const age = view ? ((detection.published_at ?? detection.occurred_at) - view.from) / span : 1;
      const alpha = 0.55 + 0.45 * Math.min(1, Math.max(0, age));

      const ground = detection.detection_type === "G";
      const skin = ground ? PIN_G : PIN_C;

      const fired =
        focus && (qualifies(focus, detection, "red") || qualifies(focus, detection, "amber"));
      if (fired) {
        // A strike that would have fired gets a halo in its tier's colour, so
        // the exceptions are findable without reading every pin.
        ctx.beginPath();
        ctx.arc(head.x, head.y, PIN_R + 5, 0, Math.PI * 2);
        ctx.fillStyle = qualifies(focus, detection, "red")
          ? `rgba(${RED.fill}, 0.55)`
          : `rgba(${AMBER.fill}, 0.55)`;
        ctx.fill();
      }

      ctx.globalAlpha = alpha;

      // Teardrop: a circular head with two tangent lines running down to the
      // tip, so the pin reads as pointing at one exact spot.
      const spread = Math.asin(Math.min(1, PIN_R / PIN_LIFT));
      ctx.beginPath();
      ctx.arc(head.x, head.y, PIN_R, Math.PI / 2 - spread, Math.PI / 2 + spread, true);
      ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.fillStyle = skin.fill;
      ctx.fill();
      ctx.strokeStyle = skin.edge;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = skin.ink;
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ground ? "G" : "C", head.x, head.y + 0.5);

      ctx.globalAlpha = 1;
    }
    plotted.current = positions;
    // `hover` is deliberately not a dependency: the tooltip is HTML, so moving
    // the pointer must not redraw the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detections, sited, centre, zoom, size.width, size.height, focus, view]);

  const drag = useRef<{
    id: number;
    origin: { latitude: number; longitude: number };
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    drag.current = {
      id: event.pointerId,
      // Anchored on the centre at drag start, not the rendered centre: reading
      // the rendered one loses every move that arrives before React re-renders,
      // and the map follows the pointer at about half speed.
      origin: centre,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    setHover(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const state = drag.current;

    if (state && state.id === event.pointerId) {
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      state.moved = true;
      setCentre(clampCentre(panCentre(state.origin, { dx: -dx, dy: -dy }, zoom), zoom, size.width, size.height));
      return;
    }

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const index = hitTest(plotted.current, x, y);
    setHover(index === -1 ? null : { index, x, y });
  }

  /**
   * Accumulated wheel travel, reset each time it buys a zoom level.
   *
   * A trackpad emits a stream of small deltas per gesture, so stepping a level
   * per event sent one flick through four levels and past whatever you were
   * trying to look at.
   */
  const wheelTravel = useRef(0);

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (classifyWheel(event) === "pan") {
      // Two-finger scroll. Straight through, no threshold: a pan should track
      // the fingers, and this is the gesture that previously did nothing at all.
      wheelTravel.current = 0;
      // Read off the event now, not inside the updater: React runs that
      // callback during a later render, and reaching into the synthetic event
      // from there is asynchronous access to a live object.
      const { deltaX, deltaY } = event;
      setCentre((point) =>
        clampCentre(panCentre(point, { dx: deltaX, dy: deltaY }, zoom), zoom, size.width, size.height),
      );
      return;
    }

    // A reversal starts a fresh count. Otherwise scrolling back up first has to
    // pay off the travel banked going down, and the map ignores you.
    if (Math.sign(event.deltaY) !== Math.sign(wheelTravel.current)) wheelTravel.current = 0;
    wheelTravel.current += event.deltaY;
    // Pinch deltas are small and continuous, so they get a much lower bar than
    // a mouse wheel — a pinch that needed six hundred pixels of travel would
    // read as broken.
    const threshold = event.ctrlKey || event.metaKey ? WHEEL_PER_ZOOM / 8 : WHEEL_PER_ZOOM;
    if (Math.abs(wheelTravel.current) < threshold) return;
    const direction = wheelTravel.current < 0 ? 1 : -1;
    wheelTravel.current = 0;

    const next = clampZoom(zoom + direction);
    if (next === zoom) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    // Keep whatever is under the cursor under the cursor, so zooming towards a
    // project does not require a pan afterwards.
    const under = pointAtOffset(centre, { dx, dy }, zoom);
    setCentre(clampCentre(panCentre(under, { dx: -dx, dy: -dy }, next), next, size.width, size.height));
    setZoom(next);
  }

  const focusOn = useCallback(
    (project: ProjectConfigRow | null) => {
      setFocusCode(project ? String(project.project_code) : null);
      setHover(null);
      if (!project) {
        setCentre(SG_CENTRE);
        setZoom(MIN_ZOOM);
        return;
      }
      setCentre({ latitude: Number(project.latitude), longitude: Number(project.longitude) });
      setZoom(14);
    },
    [],
  );

  const tiles = size.width > 0 ? tilesForViewport(centre, zoom, size.width, size.height) : [];
  // `ordered` in the draw pass is what `plotted` indexes, so the tooltip has to
  // read from the same ordering or it would describe a different strike.
  const orderedForHover = useMemo(
    () =>
      [...detections].sort((a, b) => (a.published_at ?? a.occurred_at) - (b.published_at ?? b.occurred_at)),
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
  const searchRadiusM = focus ? Math.max(1000, widestRingM(focus)) * EVIDENCE_BOX_FACTOR : 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* One row on a desktop. On a phone the controls take their own line and
          scroll sideways: stacked, they cost 320px of an 812px screen and left
          the map a strip. `order` keeps Close beside the title there without a
          second copy of the button. */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 md:px-4">
        <div className="order-1 mr-auto flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Singapore lightning map</h2>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            NEA detections, by the time they reached us
          </span>
        </div>

        <div className="order-3 flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] md:order-2 md:w-auto md:overflow-visible">
        <select
          value={focusCode ?? ""}
          onChange={(event) => {
            const code = event.target.value;
            focusOn(code ? (sited.find((row) => row.project_code === code) ?? null) : null);
          }}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs shrink-0"
        >
          <option value="">All {sited.length} projects</option>
          {sited.map((row) => (
            <option key={String(row.project_code)} value={String(row.project_code)}>
              {String(row.project_code)}
            </option>
          ))}
        </select>

        <div className="flex overflow-hidden rounded-lg border border-border shrink-0">
          {WINDOWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setWindowKey(entry.key)}
              className={`px-2.5 py-1.5 text-xs ${
                windowKey === entry.key ? "bg-primary/20 text-primary" : "hover:bg-muted/40"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/* The anchor is the END of the window, in Singapore time whatever the
            laptop is set to — see `sgtInputToMs`. */}
        <input
          type="datetime-local"
          value={sgtInputValue(anchor ?? view?.to ?? Date.now())}
          onChange={(event) => setAnchor(sgtInputToMs(event.target.value))}
          className="h-8 shrink-0 rounded-lg border border-border bg-card px-2 text-xs"
          aria-label="End of window, Singapore time"
        />
        <button
          type="button"
          onClick={() => {
            setAnchor(null);
            setTick((value) => value + 1);
          }}
          className={`h-8 shrink-0 rounded-lg border px-2.5 text-xs ${
            anchor === null
              ? "border-on/40 bg-on/10 text-on"
              : "border-border bg-card hover:border-primary hover:text-primary"
          }`}
          title={anchor === null ? "Following the clock, refreshing every minute" : "Jump back to now"}
        >
          {anchor === null ? "● Live" : "Now"}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() =>
              setZoom((current) => {
                const next = clampZoom(current - 1);
                setCentre((point) => clampCentre(point, next, size.width, size.height));
                return next;
              })
            }
            className="h-8 w-8 rounded-lg border border-border text-sm disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() =>
              setZoom((current) => {
                const next = clampZoom(current + 1);
                setCentre((point) => clampCentre(point, next, size.width, size.height));
                return next;
              })
            }
            className="h-8 w-8 rounded-lg border border-border text-sm disabled:opacity-40"
          >
            +
          </button>
        </div>

        </div>

        <button
          type="button"
          onClick={onClose}
          className="order-2 h-8 shrink-0 rounded-lg border border-border px-3 text-xs hover:border-danger hover:text-danger md:order-3"
        >
          Close
        </button>
      </header>

      <div
        ref={box}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        // OneMap's own water, so where its coverage stops the map simply keeps
        // being sea rather than turning into a dark rectangle.
        style={{ touchAction: "none", background: TILE_WATER }}
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
              {hovered.detection_type === "G" ? "⚡ Cloud-to-ground (G)" : "○ Intra-cloud (C)"}
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
                <dd>{publishLagSeconds(hovered) === null ? "—" : `${publishLagSeconds(hovered)}s`}</dd>
              </div>
              {focus ? (
                <div className="flex justify-between gap-2 text-foreground">
                  <dt>from {String(focus.project_code)}</dt>
                  <dd>
                    {formatDistance(
                      haversineMetres(
                        { lat: Number(focus.latitude), lon: Number(focus.longitude) },
                        { lat: hovered.latitude, lon: hovered.longitude },
                      ),
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        <div className="pointer-events-none absolute bottom-0 right-0 bg-card/80 px-1 text-[9px] text-muted-foreground">
          {TILE_ATTRIBUTION}
        </div>
      </div>

      <footer className="shrink-0 space-y-1.5 border-t border-border px-3 py-2 text-[11px] md:px-4">
        {error ? <p className="text-danger">{error}</p> : null}

        {summary && focus ? (
          <p className="text-xs">
            {/* The claim, in one sentence, phrased so it can be read out. */}
            <span className="font-semibold">{String(focus.project_code)}</span>{" "}
            {evidence?.payload.truncated ? (
              // An all-clear from a truncated read is a false statement, not a
              // hedged one. When the query hit its cap the panel says only what
              // it actually saw, and asks for a narrower window.
              <span className="text-warn">
                cannot be cleared for this window — the query hit its {EVIDENCE_CAP}-row cap with{" "}
                {evidence.payload.total} detections nearby, so anything earlier in the window was not
                read. Narrow the window and check again.
                {summary.red + summary.amber > 0
                  ? ` (${summary.red} red and ${summary.amber} amber already found in what was read.)`
                  : ""}
              </span>
            ) : summary.red === 0 && summary.amber === 0 ? (
              <span className="text-on">
                had no qualifying strike in this window — {summary.total === 0 ? "no" : summary.total}{" "}
                {countedTypes(focus).join("/")} detection{summary.total > 1 ? "s" : ""}{" "}
                {summary.total > 1 ? "were" : "was"} published anywhere in the{" "}
                {formatDistance(searchRadiusM)} searched around the site
                {summary.nearestM === null ? "" : `, closest ${formatDistance(summary.nearestM)}`}.
              </span>
            ) : (
              <span>
                had{" "}
                <span className="font-semibold text-danger">{summary.red} red</span> and{" "}
                <span className="font-semibold text-warn">{summary.amber} amber</span> qualifying
                strike{summary.red + summary.amber === 1 ? "" : "s"}, closest{" "}
                {formatDistance(summary.nearestM)}.
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
                  {ring.tier.toUpperCase()} {(ring.radiusM / 1000).toFixed(ring.radiusM % 1000 ? 2 : 0)} km · {ring.types}
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
          {/* The ring swatches restate what the RED/AMBER chips above already
              say, so the phone drops them rather than spending a line. */}
          <span className="hidden items-center gap-1 md:inline-flex">
            <span className="h-2 w-3 rounded-sm border border-[#f87171] bg-[#f87171]/20" /> red ring
          </span>
          <span className="hidden items-center gap-1 md:inline-flex">
            <span className="h-2 w-3 rounded-sm border border-[#fbbf24] bg-[#fbbf24]/20" /> amber ring
          </span>
          <span className="hidden md:inline">faded = earlier in the window</span>
          <span className="ml-auto font-mono">
            {loading ? "loading…" : `${detections.length} shown`}
            {view && view.total > detections.length ? ` of ${view.total} (cap ${DETECTION_CAP} — zoom in)` : ""}
            {view ? ` · ${formatSgtClock(view.from)} → ${formatSgtClock(view.to)} SGT` : ""}
          </span>
        </div>

        {/* Rings are the engine's, not the raw columns. Said out loud because the
            difference is invisible today — every project runs zero margins — and
            would otherwise look like a bug the first time someone sets one. */}
        <p className="hidden text-[10px] text-muted-foreground md:block">
          Windows filter on when NEA published a detection, not when it struck. Rings include site extent and type
          uncertainty, so they are the distances that actually trigger an alert.
        </p>
      </footer>
    </div>
  );
}
