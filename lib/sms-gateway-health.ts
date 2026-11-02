import { formatSgt } from "./card-summary";
import type { LightningNotice } from "./lightning-health";

export type SmsGatewayHealth = {
  gateway_id: string;
  gateway_name: string;
  phone_number: string | null;
  device_id: string | null;
  enabled: boolean;
  heartbeat_interval_seconds: number;
  delayed_after_seconds: number;
  critical_after_seconds: number;
  startup_grace_seconds: number;
  monitoring_started_at: string;
  last_seen_at: string | null;
  last_monitor_at: string | null;
  incident_open: boolean;
  status: "disabled" | "unknown" | "healthy" | "delayed" | "offline";
  elapsed_seconds: number | null;
  checked_at: string;
};

export type SmsGatewayEvent = {
  id: string;
  gateway_id: string;
  gateway_name: string;
  phone_number: string;
  kind: "offline" | "recovered";
  occurred_at: string;
  last_seen_at: string | null;
};

// A one-minute evaluator gets two opportunities plus 30 seconds of scheduling grace.
export function smsGatewayMonitorLate(gateway: SmsGatewayHealth): boolean {
  return gateway.enabled && (!gateway.last_monitor_at || Date.parse(gateway.checked_at) - Date.parse(gateway.last_monitor_at) > 150_000);
}

export function gatewayElapsed(seconds: number | null): string {
  if (seconds === null) return "Never received";
  const age = Math.max(0, Math.floor(seconds));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ${age % 60}s ago`;
  return `${Math.floor(age / 3600)}h ${Math.floor(age % 3600 / 60)}m ago`;
}

export function smsGatewayNotices(gateways: SmsGatewayHealth[] | null): LightningNotice[] {
  if (gateways === null) return [{
    id: "sms-gateway:coverage", name: "SMS gateways", colour: "amber",
    label: "SMS gateway health unavailable; check migration and database connectivity", detail: null,
  }];
  return gateways.filter((gateway) => gateway.enabled).flatMap((gateway) => {
    const name = `${gateway.gateway_name} · ${gateway.phone_number ?? gateway.gateway_id}`;
    const id = `sms-gateway:${gateway.gateway_id}` as const;
    const notices: LightningNotice[] = [];
    if (gateway.status === "offline" || gateway.incident_open || gateway.status === "delayed") {
      notices.push({ id, name, colour: gateway.status === "delayed" && !gateway.incident_open ? "amber" : "red",
        label: `${name}: ${gateway.last_seen_at ? `last ping ${gatewayElapsed(gateway.elapsed_seconds)}` : "no heartbeat received"}`,
        detail: gateway.last_seen_at });
    }
    if (smsGatewayMonitorLate(gateway)) {
      notices.push({ id: `sms-gateway:${gateway.gateway_id}:monitor`, name, colour: "amber",
        label: `${name}: ${gateway.last_monitor_at ? "scheduled monitor overdue" : "awaiting first scheduled monitor check"}`,
        detail: gateway.last_monitor_at });
    }
    return notices;
  });
}

export function mergeSmsGatewayNotices(notices: LightningNotice[], gateways: SmsGatewayHealth[] | null | undefined): LightningNotice[] {
  return [...notices.filter((notice) => !notice.id.startsWith("sms-gateway:")),
    ...(gateways === undefined ? [] : smsGatewayNotices(gateways))];
}

export function smsGatewayMessage(event: SmsGatewayEvent): string {
  return [
    `HALO · SMS Gateway ${event.kind === "offline" ? "NOT REPORTING" : "RECOVERED"}`,
    `${event.gateway_name} · ${event.phone_number} · ${event.gateway_id}`,
    `Recorded: ${formatSgt(event.occurred_at)} SGT`,
    `Last heartbeat received: ${event.last_seen_at ? `${formatSgt(event.last_seen_at)} SGT` : "Never received"}`,
    event.kind === "offline" ? "Check the phone's internet connection and SMS Gateway app." : "Authenticated ping reception has resumed.",
    "Heartbeat reception checks gateway connectivity only; it does not verify SMS delivery.",
  ].join("\n");
}

export type SmsGatewayMonitorDependencies = {
  now?: () => number;
  evaluate: () => Promise<number>;
  claim: () => Promise<SmsGatewayEvent | null>;
  send: (message: string) => Promise<string>;
  record: (id: string, outcome: "sent" | "queued" | "unconfirmed") => Promise<void>;
};

/** All incident and claim state is durable; a new invocation can start anywhere. */
export async function monitorSmsGateways(deps: SmsGatewayMonitorDependencies) {
  const now = deps.now ?? Date.now;
  // Leave room for the current send/state write before the relay's 25-second timeout.
  const deadline = now() + 10_000;
  const opened = await deps.evaluate();
  let attempted = 0;
  let failed = 0;
  for (; attempted < 20 && now() < deadline; attempted++) {
    const event = await deps.claim();
    if (!event) break;
    try {
      const outcome = await deps.send(smsGatewayMessage(event));
      if (outcome !== "sent" && outcome !== "queued") throw new Error("Unconfirmed notification");
      await deps.record(event.id, outcome);
    } catch {
      failed++;
      // A failed state write must not stop other gateways being reported.
      // The original claim still prevents an ambiguous send from being repeated.
      await deps.record(event.id, "unconfirmed").catch(() => undefined);
    }
  }
  return { opened, attempted, failed };
}
