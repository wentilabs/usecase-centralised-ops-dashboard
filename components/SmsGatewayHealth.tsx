"use client";

import { useEffect, useState } from "react";
import { formatSgt } from "@/lib/card-summary";
import { gatewayElapsed, smsGatewayMonitorLate, type SmsGatewayHealth as Gateway } from "@/lib/sms-gateway-health";

const TONE: Record<Gateway["status"], string> = {
  healthy: "text-on", delayed: "text-warn", offline: "text-danger",
  unknown: "text-warn", disabled: "text-muted-foreground",
};

export type SmsGatewayRead = { gateways: Gateway[] | null; state: "loading" | "ready" | "unavailable" };

export function useSmsGatewayHealth(revision: string | null): SmsGatewayRead {
  const [gateways, setGateways] = useState<Gateway[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || controller.signal.aborted || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await fetch("/api/data-health/sms-gateways", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        if (!response.ok) throw new Error("unavailable");
        const body = await response.json() as { gateways?: Gateway[] };
        if (!Array.isArray(body.gateways)) throw new Error("unavailable");
        if (!controller.signal.aborted) { setGateways(body.gateways); setState("ready"); }
      } catch {
        if (!controller.signal.aborted) { setGateways(null); setState("unavailable"); }
      } finally { busy = false; }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [revision]);
  return { gateways, state };
}

export function SmsGatewayHealth({ reading }: { reading: SmsGatewayRead }) {
  const { gateways, state } = reading;

  return <section aria-labelledby="sms-gateway-heading">
    <h3 id="sms-gateway-heading" className="text-sm font-semibold">SMS Gateway Health</h3>
    <p className="mt-1 text-xs text-muted-foreground">Time since HALO last received a ping from each phone. Checks gateway connectivity only.</p>
    {state === "loading" ? <p className="mt-3 text-sm text-muted-foreground">Checking gateway heartbeats…</p> : null}
    {state === "unavailable" ? <p className="mt-3 text-sm text-warn">Gateway health unavailable. Use Refresh health to try again; if it persists, check the heartbeat migration and database connection.</p> : null}
    {state === "ready" && !gateways?.length ? <p className="mt-3 text-sm text-muted-foreground">No SMS gateways configured.</p> : null}
    {gateways?.length ? <ul className="mt-3 divide-y divide-border border-y border-border">
      {gateways.map((gateway) => {
        const monitorLate = smsGatewayMonitorLate(gateway);
        return <li key={gateway.gateway_id} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1.5fr)] md:gap-4">
          <div className="min-w-0">
            <p className="break-all font-mono text-sm font-semibold">{gateway.phone_number ?? "Phone number not configured"}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{gateway.gateway_name}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{gateway.gateway_id}</p>
          </div>
          <p className={`text-xs font-semibold uppercase ${gateway.incident_open ? "text-danger" : TONE[gateway.status]}`}>
            {gateway.incident_open && gateway.status === "unknown" ? "Not reporting" : gateway.status}
          </p>
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Last ping: {gatewayElapsed(gateway.elapsed_seconds)}</p>
            {gateway.last_seen_at ? <p className="mt-1">{formatSgt(gateway.last_seen_at)} SGT</p> : null}
            <p className="mt-1">Every {gateway.heartbeat_interval_seconds}s · Delayed after {gateway.delayed_after_seconds}s · Offline after {gateway.critical_after_seconds}s</p>
            {gateway.enabled && gateway.last_monitor_at ? <p className="mt-1">Monitor checked: {formatSgt(gateway.last_monitor_at)} SGT</p> : null}
            {monitorLate ? <p className="mt-1 text-warn">{gateway.last_monitor_at ? "Scheduled monitor overdue. Check EventBridge and the monitor route." : "Awaiting first scheduled monitor check."}</p> : null}
            {!gateway.enabled ? <p className="mt-1">Monitoring disabled</p> : null}
          </div>
        </li>;
      })}
    </ul> : null}
  </section>;
}
