import type { ServiceKey } from "../../services";
import type { LoadProvider } from "../types";
import { ailyticsLoadProvider } from "./ailytics";
import { hazeLoadProvider } from "./haze";
import { issueChaserLoadProvider } from "./issue-chaser";
import { lightningLoadProvider } from "./lightning";
import { noiseLoadProvider } from "./noise";
import { subconLoadProvider } from "./subcon";
import { wbgtLoadProvider } from "./wbgt";

export const LOAD_PROVIDERS: Record<ServiceKey, LoadProvider> = {
  wbgt: wbgtLoadProvider,
  noise: noiseLoadProvider,
  haze: hazeLoadProvider,
  lightning: lightningLoadProvider,
  ailytics: ailyticsLoadProvider,
  subcon: subconLoadProvider,
  issueChaser: issueChaserLoadProvider,
};
