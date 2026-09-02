/**
 * Whether a keypress should be taken over to focus one of the dashboard's two
 * text entry points: the filter (⌘F) or the propose bar (⌘P).
 *
 * Pure so the rule is testable: overriding a browser shortcut is the kind of
 * thing that quietly stops working after an unrelated change, and it is not
 * something a person will report — they will just stop pressing it.
 */
export type HotkeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * One rule for both shortcuts, so they cannot drift apart.
 *
 * The escape hatch is the load-bearing part: once the target has focus, a
 * second press falls through to the browser. Taking ⌘F away entirely would
 * leave no way to search the text ON a card, and taking ⌘P away would leave no
 * way to print — both are real things to want, and a shortcut that swallows
 * them permanently is worse than no shortcut.
 */
function shouldFocus(event: HotkeyEvent, letter: string, alreadyFocused: boolean): boolean {
  if (event.key.toLowerCase() !== letter) return false;
  // ⌘ on a Mac, Ctrl elsewhere. Either, rather than sniffing the platform.
  if (!event.metaKey && !event.ctrlKey) return false;
  // The shifted and alted forms belong to the browser and to other tools.
  if (event.shiftKey || event.altKey) return false;
  return !alreadyFocused;
}

export function shouldFocusSearch(event: HotkeyEvent, searchAlreadyFocused: boolean): boolean {
  return shouldFocus(event, "f", searchAlreadyFocused);
}

/**
 * ⌘P / Ctrl+P jumps to the propose bar.
 *
 * A heavier thing to take over than ⌘F, because Print is a shortcut people use
 * deliberately rather than reflexively — hence the same escape hatch, and no
 * claim on ⇧⌘P or ⌥⌘P.
 */
export function shouldFocusPropose(event: HotkeyEvent, proposeAlreadyFocused: boolean): boolean {
  return shouldFocus(event, "p", proposeAlreadyFocused);
}
