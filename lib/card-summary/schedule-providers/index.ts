import type { ServiceKey } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { ailyticsScheduleProvider } from "./ailytics";
import { hazeScheduleProvider } from "./haze";
import { issueChaserScheduleProvider } from "./issue-chaser";
import { lightningScheduleProvider } from "./lightning";
import { noiseScheduleProvider } from "./noise";
import { subconScheduleProvider } from "./subcon";
import { wbgtScheduleProvider } from "./wbgt";

export const SCHEDULE_PROVIDERS: Record<ServiceKey, ScheduleProvider> = {
  wbgt: wbgtScheduleProvider,
  noise: noiseScheduleProvider,
  haze: hazeScheduleProvider,
  lightning: lightningScheduleProvider,
  ailytics: ailyticsScheduleProvider,
  subcon: subconScheduleProvider,
  issueChaser: issueChaserScheduleProvider,
};
