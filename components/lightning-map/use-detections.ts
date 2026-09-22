"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  EVIDENCE_BOX_FACTOR,
  EVIDENCE_CAP,
  DETECTION_CAP,
  PRIORITY_QUERY_CAP,
  boxContains,
  boundsAround,
  countedTypes,
  prioritiseDetections,
  viewportBounds,
  widestRingM,
  type Box,
  type Detection,
  type WindowKey,
} from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";

export type DetectionPayload = {
  from: number;
  to: number;
  total: number;
  truncated: boolean;
  detections: Detection[];
  prioritized?: boolean;
  priorityTruncated?: boolean;
};

async function fetchDetections(params: {
  at: number;
  window: WindowKey;
  bbox?: { south: number; west: number; north: number; east: number };
  types?: string[];
  limit?: number;
  signal: AbortSignal;
}): Promise<DetectionPayload> {
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
  return body as DetectionPayload;
}

/**
 * Own both read-only detection queries used by the map.
 *
 * The viewport layer may be cached and capped; the focused evidence layer is a
 * separate tight query because its count is operator-facing evidence and must
 * never depend on where the canvas happens to be panned.
 */
export function useLightningDetections({
  centre,
  zoom,
  size,
  windowKey,
  anchor,
  focus,
}: {
  centre: { latitude: number; longitude: number };
  zoom: number;
  size: { width: number; height: number };
  windowKey: WindowKey;
  anchor: number | null;
  focus: ProjectConfigRow | null;
}) {
  const [tick, setTick] = useState(0);
  const [liveAt, setLiveAt] = useState(() => Date.now());
  useEffect(() => {
    if (anchor === null) setLiveAt(Date.now());
  }, [anchor, tick]);
  const at = anchor ?? liveAt;

  const [baseView, setBaseView] = useState<DetectionPayload | null>(null);
  const [priority, setPriority] = useState<DetectionPayload | null>(null);
  const [evidence, setEvidence] = useState<{ payload: DetectionPayload; code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const held = useRef<{ box: Box; window: WindowKey; at: number } | null>(null);

  // Live mode re-asks once a minute. Detections publish two to four minutes
  // after the strike, so anything faster would mostly redraw the same picture.
  useEffect(() => {
    if (anchor !== null) return;
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [anchor]);

  // Debounce viewport reads while a pan or continuous zoom is in progress.
  useEffect(() => {
    if (size.width === 0) return;
    const bbox = viewportBounds(centre, zoom, size.width, size.height);
    const cached = held.current;
    if (cached && cached.window === windowKey && cached.at === at && boxContains(cached.box, bbox)) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetchDetections({ at, window: windowKey, bbox, signal: controller.signal })
        .then((payload) => {
          held.current = payload.truncated ? null : { box: bbox, window: windowKey, at };
          setBaseView(payload);
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

  useEffect(() => {
    if (!focus) {
      setPriority(null);
      setEvidence(null);
      return;
    }
    const controller = new AbortController();
    setPriority(null);
    const radius = Math.max(1000, widestRingM(focus));
    const bbox = boundsAround(
      { latitude: Number(focus.latitude), longitude: Number(focus.longitude) },
      radius * EVIDENCE_BOX_FACTOR,
    );
    fetchDetections({
      at,
      window: windowKey,
      bbox,
      types: countedTypes(focus),
      limit: EVIDENCE_CAP,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setEvidence({ payload, code: String(focus.project_code) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setEvidence(null);
      });
    fetchDetections({
      at,
      window: windowKey,
      bbox,
      types: countedTypes(focus),
      limit: PRIORITY_QUERY_CAP,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) setPriority(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPriority(null);
      });
    return () => controller.abort();
  }, [focus, windowKey, at]);

  const view = baseView
    ? {
        ...baseView,
        detections: prioritiseDetections(
          baseView.detections,
          priority?.detections ?? [],
          focus
            ? { latitude: Number(focus.latitude), longitude: Number(focus.longitude) }
            : null,
          DETECTION_CAP,
        ),
        prioritized: Boolean(focus && priority),
        priorityTruncated: Boolean(priority?.truncated),
      }
    : null;

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { at, view, evidence, loading, error, refresh };
}
