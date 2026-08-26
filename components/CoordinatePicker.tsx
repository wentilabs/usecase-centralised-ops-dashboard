"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  SG_CENTRE,
  TILE_ATTRIBUTION,
  clampZoom,
  formatCoordinate,
  panCentre,
  tileSrc,
  tilesForViewport,
} from "@/lib/slippy-map";

/**
 * Pick a project's coordinates off a map.
 *
 * The address lookup above it answers "where is 068914"; this answers "the site
 * entrance is round the back", which no postal code will tell you. Both write
 * the same two fields.
 *
 * Deliberately no mapping library. The whole job is: lay out OneMap's tiles,
 * let the viewport be dragged, and report the point under the middle — about
 * eighty lines, against a dependency that would carry its own CSS, its own SSR
 * workaround and its own upgrade treadmill. All the arithmetic lives in
 * `lib/slippy-map.ts`, where it is unit-tested, because a projection bug puts a
 * pin in the wrong place and still looks like a map.
 *
 * The pin does not move — the map does. That keeps the reported point exactly
 * under the crosshair at all times, with no marker-vs-centre drift, and it is
 * the gesture every phone map has trained people into.
 */
export function CoordinatePicker({
  latitude,
  longitude,
  disabled = false,
  onChange,
}: {
  /** The draft's current values, as typed. Blank opens over Singapore. */
  latitude: string;
  longitude: string;
  disabled?: boolean;
  onChange: (next: { latitude: string; longitude: string }) => void;
}) {
  const typed = {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
  const hasPoint = Number.isFinite(typed.latitude) && Number.isFinite(typed.longitude) && latitude !== "" && longitude !== "";

  const [zoom, setZoom] = useState(15);
  const [size, setSize] = useState({ width: 0, height: 240 });
  const box = useRef<HTMLDivElement | null>(null);
  /**
   * Drag state, anchored on where the drag STARTED.
   *
   * Every move commits `origin` panned by the cumulative offset, never the
   * currently rendered centre. Reading the rendered centre loses any move that
   * arrives before React re-renders — which is most of them during a fast drag,
   * so the map moved about half as far as the pointer did.
   */
  const drag = useRef<{
    id: number;
    origin: { latitude: number; longitude: number };
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);

  // The map follows the fields, so choosing an address above or typing a
  // coordinate below moves it. There is no second copy of the position.
  const centre = hasPoint ? { latitude: typed.latitude, longitude: typed.longitude } : SG_CENTRE;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const commit = useCallback(
    (next: { latitude: number; longitude: number }) => {
      onChange({
        latitude: formatCoordinate(next.latitude),
        longitude: formatCoordinate(next.longitude),
      });
    },
    [onChange],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    drag.current = {
      id: event.pointerId,
      origin: centre,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    state.dx = event.clientX - state.startX;
    state.dy = event.clientY - state.startY;
    // A few pixels is a click with a shaky hand, not a drag.
    if (!state.moved && Math.abs(state.dx) < 3 && Math.abs(state.dy) < 3) return;
    state.moved = true;
    // Dragging right shows what is to the west, so the centre moves west.
    commit(panCentre(state.origin, { dx: -state.dx, dy: -state.dy }, zoom));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    drag.current = null;
    if (!state || disabled) return;
    if (state.moved) return;
    // A click that was not a drag re-centres on the point clicked, so a spot in
    // view can be taken without dragging it to the middle.
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    if (dx === 0 && dy === 0) return;
    commit(panCentre(centre, { dx, dy }, zoom));
  }

  const tiles = size.width > 0 ? tilesForViewport(centre, zoom, size.width, size.height) : [];

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold">Or place the pin</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={disabled || zoom <= MIN_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current - 1))}
            className="h-6 w-6 rounded border border-border text-xs disabled:opacity-40"
          >
            −
          </button>
          <span className="w-8 text-center font-mono text-[10px] text-muted-foreground">z{zoom}</span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={disabled || zoom >= MAX_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current + 1))}
            className="h-6 w-6 rounded border border-border text-xs disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Drag the map, or click a spot. The crosshair is the coordinate — the site entrance is often not the postal
        address.
      </p>

      <div
        ref={box}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
        className={`relative mt-2 h-[240px] w-full overflow-hidden rounded-md border border-border bg-muted ${
          disabled ? "opacity-50" : "cursor-grab active:cursor-grabbing"
        }`}
        style={{ touchAction: "none" }}
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
            className="pointer-events-none absolute select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}

        {/* The crosshair. Inert, so it never eats a drag. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-5 w-5 rounded-full border-2 border-primary bg-primary/25 shadow-soft" />
          <div className="mx-auto h-3 w-0.5 bg-primary" />
        </div>

        {/* Attribution is a condition of using the tiles, not decoration. */}
        <div className="pointer-events-none absolute bottom-0 right-0 bg-card/80 px-1 text-[9px] text-muted-foreground">
          {TILE_ATTRIBUTION}
        </div>
      </div>

      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        {hasPoint ? `${latitude}, ${longitude}` : "no coordinate yet — drag or click to set one"}
      </p>
    </div>
  );
}
