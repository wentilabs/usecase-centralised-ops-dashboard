import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { mutesSuffix, subconReports } from "../schedule-helpers";

/** Service-owned card schedule and cadence semantics. */
export const subconScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    const parts: string[] = [];
    const housekeeping = config.enable_housekeeping === true;
    if (housekeeping) {
          // Supabase, not a sheet tab. The service stopped writing the Daily
          // Activity projection when Supabase became canonical, so naming the tab
          // here would send someone to a document that no longer updates.
          parts.push("housekeeping events recorded in Supabase");
        }
    const nightly =
          housekeeping && config.enabled !== false && Boolean(String(config.safety_group_ids ?? "").trim());
    if (nightly) {
          parts.push("nightly housekeeping report to the housekeeping groups");
        }
    const reports = subconReports(config);
    if (reports.length === 2) {
          parts.push("morning reports: activity + manpower, and manpower + machines");
        } else if (reports.length === 1) {
          parts.push(`only the ${reports[0]} morning report`);
        }
    if (!parts.length) return "Nothing is accepted and nothing is sent";
    let line = `Event-driven on forwarded WhatsApp — ${parts.join(" · ")}`;
    if (reports.length && !String(config.manpower_activity_outbound_group_id ?? "").trim()) {
          line += " — no report group set, so nothing is delivered";
        }
    if (nightly || reports.length) {
          line += mutesSuffix(config, "no reports on");
        }
    return line;
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return config.enable_housekeeping === true || subconReports(config).length > 0;
  },
};
