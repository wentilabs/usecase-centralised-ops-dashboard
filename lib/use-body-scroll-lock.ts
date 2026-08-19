"use client";

import { useEffect } from "react";

/**
 * Freeze the page behind a mobile overlay while it is open.
 *
 * Used only by the mobile-only surfaces (service drawer, project sheet). The
 * desktop editor drawer deliberately does not call this, so scrolling there
 * behaves exactly as it always has.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

/** Close an overlay on Escape — phones with keyboards attached, and desktop resizes. */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}
