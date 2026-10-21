import type { LoadProvider, RowLoad } from "../types";

/**
 * Vibration sends no scheduled WhatsApp traffic. The scrape writes readings; the
 * only message the service can send is the operator-run `/test-notification`
 * diagnostic, which has no clock position. So no occurrences and nothing ambient.
 */
export const vibrationLoadProvider: LoadProvider = {
  forRow(): RowLoad {
    return { occurrences: [], ambient: [] };
  },
};
