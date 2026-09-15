"use client";

import { useCallback, useEffect, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";

import { hitTest } from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";
import {
  MAX_ZOOM,
  SG_CENTRE,
  clampCentre,
  classifyWheel,
  fitZoom,
  panCentre,
  pinchZoom,
  pointAtOffset,
  wheelZoomLevels,
} from "@/lib/slippy-map";

type Point = { latitude: number; longitude: number };
type Size = { width: number; height: number };
type Hover = { index: number; x: number; y: number } | null;

/** Own pointer, pinch, wheel, focus, and button navigation for the map. */
export function useLightningGestures({
  plotted,
  centre,
  setCentre,
  zoom,
  setZoom,
  size,
  minZoom,
  setHover,
  setFocusCode,
}: {
  plotted: RefObject<{ x: number; y: number }[]>;
  centre: Point;
  setCentre: Dispatch<SetStateAction<Point>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  size: Size;
  minZoom: number;
  setHover: Dispatch<SetStateAction<Hover>>;
  setFocusCode: Dispatch<SetStateAction<string | null>>;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const hold = (value: number) => Math.min(MAX_ZOOM, Math.max(minZoom, value));

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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
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

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
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

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
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

  return { box, onPointerDown, onPointerMove, onPointerEnd, focusOn, step };
}

