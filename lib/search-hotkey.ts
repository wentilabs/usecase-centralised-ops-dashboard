/**
 * Whether a keypress should be taken over to focus the dashboard's filter.
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

export function shouldFocusSearch(event: HotkeyEvent, searchAlreadyFocused: boolean): boolean {
  if (event.key.toLowerCase() !== "f") return false;
  // ⌘F on a Mac, Ctrl+F elsewhere. Either, rather than sniffing the platform.
  if (!event.metaKey && !event.ctrlKey) return false;
  // ⌘⇧F and ⌥⌘F belong to the browser and to other tools; only the plain form.
  if (event.shiftKey || event.altKey) return false;
  // The escape hatch: once the filter has focus, a second press falls through to
  // the browser's own find. Taking the shortcut away entirely would leave no way
  // to search the text ON a card, which is a real thing to want.
  return !searchAlreadyFocused;
}
