import type { ProjectConfigRow, ServiceKey } from "../services";

/** Noise repo's quirky literal column name. */
export const ASSESS_COL = 'assessment_readings_mm_array("35,45,55")';

export function splitList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
/**
 * Which column(s) hold a service's WhatsApp group ids, and what each one is for.
 *
 * Every alert service keeps its groups in exactly one column, so a single entry
 * is equivalent to the old `?? ` fallback chain. Subcon is the first service
 * with several group columns that mean different things — showing them as one
 * undifferentiated list would lose that, hence the roles.
 */
const GROUP_COLUMNS: Record<ServiceKey, { column: string; role?: string }[]> = {
  wbgt: [
    { column: "whatsapp_group_id" },
    // This was a `single` column: the service read it with a bare
    // `String(...).trim()` and posted the whole value as one chatId, so a second
    // id corrupted the send rather than adding a recipient. `ff2ec70` in the
    // WBGT repo split it on commas and `migrate_water_parade_multiple_groups.sql`
    // dropped the CHECK that enforced one — verified gone against the live
    // table. Each id now gets its own reminder, delivery row and outbound
    // message id, so quoted replies still correlate per group.
    { column: "water_parade_outbound_group_id", role: "water parade" },
  ],
  noise: [
    { column: "whatsapp_group_id" },
    // Opt-in second destination, and only for messages carrying a 🟠 or 🔴 —
    // the role says so, because a chip that just read as another recipient
    // would imply these groups get the whole half-hourly stream.
    { column: "exceedance_half_hourly_wa_groups", role: "half-hourly warnings only" },
  ],
  haze: [{ column: "wa_group_ids" }],
  lightning: [{ column: "whatsapp_group_id" }],
  ailytics: [{ column: "whatsapp_group_ids" }],
  // Labelled because the two lists are not interchangeable and one of them is
  // now BOTH directions: since 140b1e9 `safety_group_ids` is where forwarded
  // messages come from AND where the nightly housekeeping report goes, while
  // the summary destination carries only the two morning summaries. Calling it
  // "inbound" told an operator it receives nothing, which is no longer true.
  subcon: [
    { column: "manpower_activity_outbound_group_id", role: "morning summaries" },
    { column: "safety_group_ids", role: "housekeeping in/out" },
  ],
  issueChaser: [{ column: "whatsapp_group_ids" }],
};

export type DeliveryGroup = { chatId: string; role?: string };

/**
 * The groups a project talks to, de-duplicated. One group commonly serves two
 * roles (the TEST project uses one chat for both reports), so roles are merged
 * onto a single entry rather than repeating the chat id — which would also
 * collide as a React key.
 */
/**
 * Which columns of a service hold chat ids, and what each is for.
 *
 * Exposed so the bulk-edit path in `chat-scope.ts` reads the same registry the
 * cards render delivery chips from. A second list of group columns would drift,
 * and the way it would drift is by missing one — leaving a group in place on a
 * column nobody remembered.
 */
export function groupColumnsFor(service: ServiceKey): { column: string; role?: string }[] {
  return GROUP_COLUMNS[service] ?? [];
}

export function deliveryGroups(service: ServiceKey, config: ProjectConfigRow): DeliveryGroup[] {
  const roles = new Map<string, string[]>();
  for (const { column, role } of GROUP_COLUMNS[service] ?? []) {
    const ids = splitList(config[column]);
    for (const [index, chatId] of ids.entries()) {
      const existing = roles.get(chatId) ?? [];
      const effective = role;
      if (effective && !existing.includes(effective)) existing.push(effective);
      roles.set(chatId, existing);
    }
  }
  return [...roles].map(([chatId, list]) => ({
    chatId,
    role: list.length ? list.join(" + ") : undefined,
  }));
}

/**
 * Every column, across every service, that stores WhatsApp chat ids: the
 * delivery columns above, plus the ones that carry chat ids for some purpose
 * other than delivery (mentions, expiry alerts, photo ingestion).
 *
 * Derived rather than hand-listed so a new service's delivery columns are
 * picked up automatically — this list decides which ids get a name resolved,
 * and a missing column means raw ids on the cards.
 */
export const CHAT_ID_COLUMNS: string[] = [
  ...new Set([
    ...Object.values(GROUP_COLUMNS).flatMap((entries) => entries.map((entry) => entry.column)),
    "alert_whatsapp_gid",
    "poc_alert_wa_groups",
    "whatsapp_wbgt_source_chat_ids",
    // Not a destination — it is the snapshot's exclusion list — but it holds
    // chat ids, so it needs names resolved for the picker like any other.
    "exclude_whatsapp_group_ids",
  ]),
];

/** Group ids referenced by any of those columns, across the rows given. */
export function chatIdsIn(rows: ProjectConfigRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const column of CHAT_ID_COLUMNS) {
      for (const id of splitList(row[column])) {
        if (id.endsWith("@g.us")) ids.add(id);
      }
    }
  }
  return [...ids];
}
