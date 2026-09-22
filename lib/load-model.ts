/**
 * How much outbound traffic each hour of the day carries, from configuration
 * alone.
 *
 * The question this answers: at 08:00, how many messages go out to how many
 * groups across the whole estate? It is asked because sends cluster — several
 * services put their reports on the same round hour — and a cluster is where
 * the provider starts refusing them.
 *
 * Everything here is derived from the config rows the dashboard already holds.
 * No new query, no persistence, and nothing observed: this is what the crons
 * are CONFIGURED to do, not what they did. Where the configuration cannot say,
 * it says so rather than guessing — see `Certainty` and `Ambient`.
 *
 * Hour resolution, deliberately, and the hours are constrained by the real
 * EventBridge rules in `load-model/crons.ts` — a configured hour only counts
 * when the rule that reads it actually runs in that hour. Without that the
 * chart placed the Issue Chaser chat-group summary wherever its schedule
 * column pointed, while its rule fires once a day.
 */
export { dayLoad, hourDetail, hourLabel, occurrencesFor, type DayLoad, type HourBucket } from "./load-model/day-load";
export { LOAD_PROVIDERS } from "./load-model/providers";
export type { Ambient, Certainty, LoadProvider, Occurrence, RowLoad } from "./load-model/types";
