"use client";

import { useEffect, useRef } from "react";

import {
  qualifies,
  radiusPixels,
  ringsFor,
  screenPoint,
  type Detection,
} from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";
import type { DetectionPayload } from "./use-detections";

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

/** Draw map evidence and expose the strike-head positions used by hit testing. */
export function useLightningCanvas({
  detections,
  sited,
  centre,
  zoom,
  size,
  focus,
  view,
}: {
  detections: Detection[];
  sited: ProjectConfigRow[];
  centre: { latitude: number; longitude: number };
  zoom: number;
  size: { width: number; height: number };
  focus: ProjectConfigRow | null;
  view: DetectionPayload | null;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const plotted = useRef<{ x: number; y: number }[]>([]);

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

  return { canvas, plotted };
}

