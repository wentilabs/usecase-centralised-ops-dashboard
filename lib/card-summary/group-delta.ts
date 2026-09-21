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

export type SensorMapEntry = {
  sensorLabel: string;
  /** Group names, resolved; the raw id when the alias store has never seen it. */
  from: string | null;
  to: string | null;
  fromId: string | null;
  toId: string | null;
  state: "added" | "removed" | "changed" | "kept";
};

/**
 * A sensor-to-group map, as a readable before-and-after.
 *
 * The confirm dialog rendered this column with the same stringify every other
 * column uses, which for a jsonb object produces "[object Object] →
 * [object Object]" — a review step that shows nothing to review, on the one
 * field where getting the wrong group means a site's alerts go to strangers.
 *
 * Resolved to group names for the same reason the group delta is: nobody can
 * look at 120363413253110834@g.us and say whether it is the right chat.
 */
export function sensorGroupDelta(
  from: unknown,
  to: unknown,
  names: Record<string, string> = {},
): SensorMapEntry[] {
  const asMap = (value: unknown): Record<string, string> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .map(([sensor, id]) => [sensor, String(id ?? "").trim()])
            .filter(([, id]) => id !== ""),
        )
      : {};

  const before = asMap(from);
  const after = asMap(to);
  const label = (id: string | null) => (id ? names[id] ?? id : null);

  // Every sensor either side mentions, in a stable order so two renders of the
  // same change do not disagree about what moved.
  const sensors = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  return sensors.map((sensorLabel) => {
    const fromId = before[sensorLabel] ?? null;
    const toId = after[sensorLabel] ?? null;
    const state = fromId === toId ? "kept" : !fromId ? "added" : !toId ? "removed" : "changed";
    return { sensorLabel, fromId, toId, from: label(fromId), to: label(toId), state };
  });
}
