import type { ProjectHealth } from "./data-health";
import { currentHealthWindow, dueHealthWindow, healthSummary, healthSummaryKey, type HealthNotifyOptions } from "./health-notifications";
import type { Bar } from "./health-timeline";
import type { LightningNotice } from "./lightning-health";

export type HealthNotificationDependencies = {
  alreadyClaimed: (key: string) => Promise<boolean>;
  claim: (key: string) => Promise<boolean>;
  read: (since: Date) => Promise<{
    health: ProjectHealth[];
    strips: Record<string, Bar[]>;
    faults: Record<string, string>;
    notices: LightningNotice[];
  }>;
  send: (message: string) => Promise<string>;
  record: (key: string, outcome: string) => Promise<void>;
};

/** Scheduled sends use the durable claim; explicit manual modes never touch it. */
export async function executeHealthNotification(now: Date, options: HealthNotifyOptions, deps: HealthNotificationDependencies) {
  const manual = options.dryRun || options.force;
  const window = manual ? currentHealthWindow(now) : dueHealthWindow(now);
  if (!window) return { due: false, delivered: 0 };
  if (!manual && await deps.alreadyClaimed(healthSummaryKey(window.end))) {
    return { due: true, delivered: 0, duplicates: 1 };
  }

  const readings = await deps.read(window.start);
  const summary = healthSummary({ windowStart: window.start, windowEnd: window.end, ...readings });
  if (options.dryRun) {
    return { dryRun: true, delivered: 0, evaluated: summary.issueCount,
      windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(), message: summary.message };
  }
  if (options.force) {
    const outcome = await deps.send(summary.message);
    return { forced: true, delivered: 1, outcome, evaluated: summary.issueCount,
      windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(), message: summary.message };
  }
  if (!await deps.claim(summary.key)) {
    return { due: true, evaluated: summary.issueCount, delivered: 0, duplicates: 1 };
  }
  try {
    const outcome = await deps.send(summary.message);
    await deps.record(summary.key, outcome);
  } catch (error) {
    await deps.record(summary.key, "unconfirmed");
    throw error;
  }
  return { due: true, evaluated: summary.issueCount, delivered: 1, duplicates: 0 };
}
