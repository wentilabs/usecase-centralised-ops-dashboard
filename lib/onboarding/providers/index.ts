import type { ServiceKey } from "../../services";
import type { OnboardDefinition } from "../types";
import { ailyticsOnboarding } from "./ailytics";
import { hazeOnboarding } from "./haze";
import { issueChaserOnboarding } from "./issue-chaser";
import { lightningOnboarding } from "./lightning";
import { noiseOnboarding } from "./noise";
import { subconOnboarding } from "./subcon";
import { wbgtOnboarding } from "./wbgt";

export const ONBOARDING: Partial<Record<ServiceKey, OnboardDefinition>> = {
  haze: hazeOnboarding,
  lightning: lightningOnboarding,
  noise: noiseOnboarding,
  subcon: subconOnboarding,
  issueChaser: issueChaserOnboarding,
  wbgt: wbgtOnboarding,
  ailytics: ailyticsOnboarding,
};
