import type { ProjectConfigRow, ServiceKey } from "../services";
import { PILL_PROVIDERS } from "./pill-providers";

export type { Pill } from "./pill-types";
export { usesManpowerSheetPocs } from "./pill-providers/wbgt";

/** Dispatch card capabilities to the owning service provider. */
export function pillsFor(service: ServiceKey, config: ProjectConfigRow) {
  return PILL_PROVIDERS[service](config);
}
