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
 * Hour resolution, deliberately. The minute each cron fires lives in an
 * EventBridge rule in the AWS console, not in any repository, and the service
 * READMEs that document those minutes disagree with each other in at least one
 * place. At hourly resolution none of that matters.
 */
export { dayLoad, hourDetail, hourLabel, occurrencesFor, type DayLoad, type HourBucket } from "./load-model/day-load";
export { LOAD_PROVIDERS } from "./load-model/providers";
export type { Ambient, Certainty, LoadProvider, Occurrence, RowLoad } from "./load-model/types";
