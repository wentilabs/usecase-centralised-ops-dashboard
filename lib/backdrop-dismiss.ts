"use client";

import { useRef } from "react";

/**
 * Whether a click on a dialog's backdrop should close it.
 *
 * The whole rule is "the gesture began and ended on the backdrop itself", and
 * both halves matter:
 *
 *  - ended there, because a click on anything inside the panel bubbles up to
 *    the backdrop, and closing on that would make every button dismiss the
 *    dialog it belongs to.
 *  - began there, because selecting text inside the panel and releasing past
 *    its edge is an ordinary gesture, and losing a half-filled form to it is
 *    exactly the kind of thing nobody reports — they just stop selecting text.
 *
 * Pure so those two conditions can be tested; the hook below is the wiring.
 */
export function shouldDismissBackdrop(startedOnBackdrop: boolean, endedOnBackdrop: boolean): boolean {
  return startedOnBackdrop && endedOnBackdrop;
}

/**
 * Props for a dialog's backdrop element, giving it click-to-close.
 *
 * `active` mirrors whatever guard that dialog already passes to `useEscapeKey`,
 * so the two ways out agree: a dialog that refuses Escape mid-save refuses this
 * too, rather than letting a stray click abandon a request that is in flight.
 */
export function useBackdropDismiss(active: boolean, onDismiss: () => void) {
  const startedOnBackdrop = useRef(false);
  return {
    onMouseDown: (event: React.MouseEvent) => {
      startedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent) => {
      const ended = event.target === event.currentTarget;
      const dismiss = active && shouldDismissBackdrop(startedOnBackdrop.current, ended);
      startedOnBackdrop.current = false;
      if (dismiss) onDismiss();
    },
  };
}
