import { ONBOARDING } from "./onboarding/providers";
import type { ServiceKey } from "./services";

export { ONBOARDING } from "./onboarding/providers";
export { noiseTableForProject, wbgtTableForProject } from "./onboarding/naming";
export { buildInsertRow } from "./onboarding/row-plan";
export { withSchemaFields } from "./onboarding/schema-fields";
export type {
  OnboardDefinition,
  OnboardDraft,
  OnboardField,
  OnboardFieldKind,
} from "./onboarding/types";
export { missingEnvDefaults, prefillDefaults, resolveValue } from "./onboarding/values";
export { validateDraft } from "./onboarding/validation";

/** Return the service-owned creation contract, or null when unsupported. */
export function onboardingFor(service: ServiceKey) {
  return ONBOARDING[service] ?? null;
}
