import type { ProjectConfigRow, ServiceKey } from "../services";
import { PILL_PROVIDERS } from "./pill-providers";

export type { Pill } from "./pill-types";
export { usesManpowerSheetPocs } from "./pill-providers/wbgt";

/**
 * Dispatch card capabilities to the owning service provider, then show only
 * what is in force.
 *
 * A card used to carry both halves of every switch: "mute Sundays" lit on the
 * projects that mute them and struck through on the projects that do not. On a
 * card with fourteen pills that doubles the reading work to convey the same
 * fact, and the struck half is the half nobody is looking for — the eye has to
 * check each pill's styling before it can be read as present or absent.
 *
 * So absence is the off state. A provider still returns `on: false`, because
 * that is how it says "this project does not do X", and the filter here is the
 * single place that turns that into silence. Where being off is itself the
 * notable thing — a Water Parade site with no reminders, a roster that counts
 * Woh Hup in — the provider states the exception positively instead, so the
 * fact survives as a pill that is ON rather than as a style on a pill that is
 * off.
 */
export function pillsFor(service: ServiceKey, config: ProjectConfigRow) {
  return PILL_PROVIDERS[service](config).filter((pill) => pill.on);
}
