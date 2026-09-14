import type { ServiceKey } from "../../services";
import type { PillProvider } from "../pill-types";
import { ailyticsPills } from "./ailytics";
import { hazePills } from "./haze";
import { issueChaserPills } from "./issue-chaser";
import { lightningPills } from "./lightning";
import { noisePills } from "./noise";
import { subconPills } from "./subcon";
import { wbgtPills } from "./wbgt";

export const PILL_PROVIDERS: Record<ServiceKey, PillProvider> = {
  wbgt: wbgtPills,
  noise: noisePills,
  haze: hazePills,
  lightning: lightningPills,
  ailytics: ailyticsPills,
  subcon: subconPills,
  issueChaser: issueChaserPills,
};
