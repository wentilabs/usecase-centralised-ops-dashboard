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
  boundsAspect,
  clampCentre,
  classifyWheel,
  fitZoom,
  pinchZoom,
  wheelZoomLevels,
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
  const query = new URLSearchParams({
    at: String(params.at),
    window: params.window,
  });
  if (params.limit) query.set("limit", String(params.limit));
  if (params.types?.length) query.set("types", params.types.join(","));
  if (params.bbox) {
    const { south, west, north, east } = params.bbox;
    query.set(
      "bbox",
      [south, west, north, east].map((value) => value.toFixed(5)).join(","),
    );
  }
  const response = await fetch(`/api/lightning/detections?${query}`, {
    signal: params.signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body?.error ?? `Request failed (${response.status})`);
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
    const start = initialFocus
      ? projects.find((row) => row.project_code === initialFocus)
      : null;
    return start && Number.isFinite(Number(start.latitude))
      ? { latitude: Number(start.latitude), longitude: Number(start.longitude) }
      : SG_CENTRE;
  });
  const [zoom, setZoom] = useState(initialFocus ? 14 : MIN_ZOOM);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /**
   * The map box is cut to Singapore's own proportions, so the whole island
   * fills it exactly at this zoom — there is no view worth showing further out,
   * and allowing one would only add water. Replaces the fixed MIN_ZOOM, which
   * was right for one screen size and arbitrary on every other.
   */
  const minZoom = fitZoom(size.width, size.height);
  /** Zoom is continuous; this only keeps it inside the usable range. */
  const hold = (value: number) => Math.min(MAX_ZOOM, Math.max(minZoom, value));

  const [view, setView] = useState<Payload | null>(null);
  const [evidence, setEvidence] = useState<{
    payload: Payload;
    code: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);

  const box = useRef<HTMLDivElement | null>(null);
  /** The space the map is centred in. The map itself is cut to fit it. */
  const frame = useRef<HTMLDivElement | null>(null);
  /** Read by handlers that must not re-subscribe on every render. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const centreRef = useRef(centre);
  centreRef.current = centre;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** Where each drawn strike landed, so the pointer can be matched to one. */
  const plotted = useRef<{ x: number; y: number }[]>([]);
  /**
   * The box the last complete map fetch covered, and the query it answered.
   * A pan or zoom that stays inside it needs no request — see `boxContains`.
   */
  const held = useRef<{ box: Box; window: WindowKey; at: number } | null>(null);

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
          held.current = payload.truncated
            ? null
            : { box: bbox, window: windowKey, at };
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
        {
          latitude: Number(focus.latitude),
          longitude: Number(focus.longitude),
        },
        radius * EVIDENCE_BOX_FACTOR,
      ),
      // Only the types this project's tiers count. Everything else is noise
      // that can only push a qualifying strike out of a capped result.
      types: countedTypes(focus),
      limit: EVIDENCE_CAP,
      signal: controller.signal,
    })
      .then((payload) =>
        setEvidence({ payload, code: String(focus.project_code) }),
      )
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
        for (const ring of ringsFor(project).filter(
          (entry) => entry.tier === tier,
        )) {
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
      const point = screenPoint(
        { latitude, longitude },
        centre,
        zoom,
        size.width,
        size.height,
      );
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
          if (
            focus &&
            project.project_code === focus.project_code &&
            pixels > 34
          ) {
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
            labelX = Math.min(
              Math.max(labelX, width / 2 + 6),
              size.width - width / 2 - 6,
            );
            while (
              labelled.some(
                (placed) =>
                  Math.abs(placed.y - labelY) < 15 &&
                  Math.abs(placed.x - labelX) < (placed.w + width) / 2 + 6,
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
        {
          latitude: Number(project.latitude),
          longitude: Number(project.longitude),
        },
        centre,
        zoom,
        size.width,
        size.height,
      );
      if (
        point.x < -60 ||
        point.x > size.width + 60 ||
        point.y < -30 ||
        point.y > size.height + 30
      )
        continue;
      const isFocus = !focus || project.project_code === focus.project_code;

      ctx.beginPath();
      ctx.arc(point.x, point.y, isFocus ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isFocus ? "#e2e8f0" : "rgba(226, 232, 240, 0.45)";
      ctx.fill();
      ctx.strokeStyle = "rgba(10, 12, 16, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (
        zoom >= LABEL_ZOOM ||
        (focus && project.project_code === focus.project_code)
      ) {
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
      (a, b) =>
        (a.published_at ?? a.occurred_at) - (b.published_at ?? b.occurred_at),
    );

    for (const detection of ordered) {
      const point = screenPoint(
        detection,
        centre,
        zoom,
        size.width,
        size.height,
      );
      // The pin's tip marks the strike; its head sits above. Hit-testing uses
      // the head, because that is the part the pointer can actually land on.
      const head = { x: point.x, y: point.y - PIN_LIFT };
      positions.push(head);
      if (
        point.x < -20 ||
        point.x > size.width + 20 ||
        point.y < -30 ||
        point.y > size.height + 20
      )
        continue;

      // Older strikes fade, so a storm crossing the island reads as a direction
      // of travel. The floor is high enough that an old pin is still legible —
      // it is evidence, not decoration.
      const age = view
        ? ((detection.published_at ?? detection.occurred_at) - view.from) / span
        : 1;
      const alpha = 0.55 + 0.45 * Math.min(1, Math.max(0, age));

      const ground = detection.detection_type === "G";
      const skin = ground ? PIN_G : PIN_C;

      const fired =
        focus &&
        (qualifies(focus, detection, "red") ||
          qualifies(focus, detection, "amber"));
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
      ctx.arc(
        head.x,
        head.y,
        PIN_R,
        Math.PI / 2 - spread,
        Math.PI / 2 + spread,
        true,
      );
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

  /**
   * Every pointer currently down, by id.
   *
   * Two fingers on a phone is a pinch, and pinch is the gesture people reach
   * for first on a map. Tracking pointers rather than handling a single drag is
   * what makes that possible — the previous version simply ignored the second
   * finger, so a phone could pan and nothing else.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>());

  /**
   * The gesture in progress, anchored on the state it started from.
   *
   * Anchored rather than integrated frame by frame for the same reason
   * throughout this file: reading back the rendered value loses every event
   * that arrives before React re-renders, which during a fast gesture is most
   * of them. It also means a pinch out and back lands exactly where it began.
   */
  const gesture = useRef<{
    kind: "drag" | "pinch";
    origin: { latitude: number; longitude: number };
    startZoom: number;
    /** Screen point the gesture is anchored on: the finger, or the midpoint. */
    anchorX: number;
    anchorY: number;
    /** Pinch only: how far apart the fingers started. */
    spread: number;
    moved: boolean;
  } | null>(null);

  const midpoint = () => {
    const points = [...touches.current.values()];
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const spread =
      points.length < 2
        ? 0
        : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    return { x, y, spread };
  };

  const beginGesture = () => {
    const { x, y, spread } = midpoint();
    gesture.current = {
      kind: touches.current.size >= 2 ? "pinch" : "drag",
      origin: centre,
      startZoom: zoom,
      anchorX: x,
      anchorY: y,
      spread,
      moved: touches.current.size >= 2,
    };
  };

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    touches.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    // Re-anchored whenever the number of fingers changes, so putting a second
    // finger down starts a pinch from where the drag had got to rather than
    // snapping back to where the drag began.
    beginGesture();
    setHover(null);
    // Throws if the pointer has already ended — which a second finger lifted
    // between the event and this call really can do. Losing capture only means
    // the gesture ends when the finger leaves the element, which is survivable;
    // an exception here would abort the handler and strand the gesture state.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer is gone; the gesture will end on its own */
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();

    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const state = gesture.current;
      if (!state) return;
      const now = midpoint();

      if (state.kind === "pinch" && touches.current.size >= 2) {
        const next = hold(pinchZoom(state.startZoom, state.spread, now.spread));
        // The point under the fingers when the pinch started stays under them:
        // one gesture zooms and pans at once, as it does on a phone's own maps.
        const from = {
          dx: state.anchorX - rect.left - rect.width / 2,
          dy: state.anchorY - rect.top - rect.height / 2,
        };
        const to = {
          dx: now.x - rect.left - rect.width / 2,
          dy: now.y - rect.top - rect.height / 2,
        };
        const under = pointAtOffset(state.origin, from, state.startZoom);
        setCentre(
          clampCentre(
            panCentre(under, { dx: -to.dx, dy: -to.dy }, next),
            next,
            size.width,
            size.height,
          ),
        );
        setZoom(next);
        return;
      }

      const dx = now.x - state.anchorX;
      const dy = now.y - state.anchorY;
      // A few pixels is a shaky hand, not a drag.
      if (!state.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      state.moved = true;
      setCentre(
        clampCentre(
          panCentre(state.origin, { dx: -dx, dy: -dy }, state.startZoom),
          state.startZoom,
          size.width,
          size.height,
        ),
      );
      return;
    }

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const index = hitTest(plotted.current, x, y);
    setHover(index === -1 ? null : { index, x, y });
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    touches.current.delete(event.pointerId);
    // Lifting one finger of a pinch leaves the other one dragging, from where
    // the map is now — without re-anchoring, the map would jump.
    if (touches.current.size > 0) beginGesture();
    else gesture.current = null;
  }

  /**
   * The wheel handler is bound natively, not through `onWheel`.
   *
   * React registers wheel listeners as **passive**, where `preventDefault` is
   * ignored — so a pinch over the map zoomed the whole browser and took the
   * header and footer off screen with it. A non-passive listener is the only
   * way to keep the gesture inside the canvas. Kept in a ref so the listener is
   * bound once while still seeing current state.
   */
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const handler = (event: WheelEvent) => {
      // Every wheel event over the map belongs to the map: pinch must not zoom
      // the page, and a two-finger scroll must not scroll it either.
      event.preventDefault();
      wheelRef.current(event);
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, []);

  wheelRef.current = function onWheel(event: WheelEvent) {
    if (classifyWheel(event) === "pan") {
      // Two-finger scroll. Straight through, no threshold: a pan should track
      // the fingers, and this is the gesture that once did nothing at all.
      const { deltaX, deltaY } = event;
      setCentre((point) =>
        clampCentre(
          panCentre(point, { dx: deltaX, dy: deltaY }, zoom),
          zoom,
          size.width,
          size.height,
        ),
      );
      return;
    }

    // A fraction of a level per event, rather than banking travel until it buys
    // a whole one. Tiles draw at the nearest whole level and the layer is scaled
    // to meet the fractional one, so this reads as smooth rather than as a jump
    // per notch — and it is finer to control, which banking never was.
    const next = hold(zoom + wheelZoomLevels(event));
    if (next === zoom) return;
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    // Keep whatever is under the cursor under the cursor, so zooming towards a
    // project does not need a pan afterwards.
    const under = pointAtOffset(centre, { dx, dy }, zoom);
    setCentre(
      clampCentre(
        panCentre(under, { dx: -dx, dy: -dy }, next),
        next,
        size.width,
        size.height,
      ),
    );
    setZoom(next);
  };

  const focusOn = useCallback((project: ProjectConfigRow | null) => {
    setFocusCode(project ? String(project.project_code) : null);
    setHover(null);
    if (!project) {
      setCentre(SG_CENTRE);
      setZoom(fitZoom(sizeRef.current.width, sizeRef.current.height));
      return;
    }
    setCentre({
      latitude: Number(project.latitude),
      longitude: Number(project.longitude),
    });
    setZoom(14);
  }, []);

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

  /**
   * Zoom in/out, defined once and placed twice: in the header on a desktop,
   * floated over the map on a phone. Two copies of this JSX would drift, and
   * the phone's copy is the one nobody would remember to update.
   */
  const step = (direction: 1 | -1) =>
    setZoom((current) => {
      // Whole levels from wherever a gesture left off, so a button press stays
      // a predictable step even after a pinch has landed on 14.6.
      const next = hold(Math.round(current) + direction);
      setCentre((point) => clampCentre(point, next, size.width, size.height));
      return next;
    });

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
              setTick((value) => value + 1);
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
