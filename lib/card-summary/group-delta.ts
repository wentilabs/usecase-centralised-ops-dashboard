import { splitList } from "./groups";

/** One chat id in a group-list change, and what happened to it. */
export type GroupDelta = { chatId: string; name: string; state: "added" | "removed" | "kept" };

/**
 * A change to a group-id column, as names rather than numbers.
 *
 * The confirmation panel used to print these columns the way it prints every
 * other value: the raw stored string, so approving a delivery change meant
 * reading `120363410971872748@g.us` and deciding from that whether it was the
 * right chat. Nobody can. The names are already loaded for the group picker on
 * the same screen, so the panel had them all along.
 *
 * It returns a per-id delta rather than two lists of names because names are
 * far longer than ids: rendering before-and-after as prose would have made a
 * one-group change harder to read, not easier. Removed first, then added, then
 * the untouched ones as context — the order someone checks a change in.
 *
 * An id with no known name keeps the id, which is honest: an alias that has not
 * been fetched must not look like a group that does not exist.
 */
export function groupDelta(
  from: unknown,
  to: unknown,
  names: Record<string, string> = {},
): GroupDelta[] {
  const before = splitList(from);
  const after = splitList(to);
  const label = (chatId: string) => ({ chatId, name: names[chatId] ?? chatId });
  return [
    ...before.filter((id) => !after.includes(id)).map((id) => ({ ...label(id), state: "removed" as const })),
    ...after.filter((id) => !before.includes(id)).map((id) => ({ ...label(id), state: "added" as const })),
    ...after.filter((id) => before.includes(id)).map((id) => ({ ...label(id), state: "kept" as const })),
  ];
}
