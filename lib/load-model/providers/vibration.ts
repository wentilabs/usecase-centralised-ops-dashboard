import type { LoadProvider, RowLoad } from "../types";

/** Vibration schedules scraping and the opted-in morning kickoff. */
export const vibrationLoadProvider: LoadProvider = {
  forRow(): RowLoad {
    return { occurrences: [], ambient: [] };
  },
};
