import type { ServiceFieldProvider } from "../types";
import { ailyticsFieldProvider } from "./ailytics";
import { hazeFieldProvider } from "./haze";
import { issueChaserFieldProvider } from "./issue-chaser";
import { lightningFieldProvider } from "./lightning";
import { noiseFieldProvider } from "./noise";
import { subconFieldProvider } from "./subcon";
import { wbgtFieldProvider } from "./wbgt";

export const FIELD_PROVIDERS: Record<string, ServiceFieldProvider> = {
  wbgt: wbgtFieldProvider,
  noise: noiseFieldProvider,
  haze: hazeFieldProvider,
  lightning: lightningFieldProvider,
  ailytics: ailyticsFieldProvider,
  subcon: subconFieldProvider,
  issueChaser: issueChaserFieldProvider,
};
