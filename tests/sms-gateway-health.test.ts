import test from "node:test";
import assert from "node:assert/strict";
import { gatewayElapsed, mergeSmsGatewayNotices, monitorSmsGateways, smsGatewayMessage, smsGatewayNotices, type SmsGatewayEvent, type SmsGatewayHealth } from "../lib/sms-gateway-health";
import { healthNotificationAuthorized, sendHealthNotification } from "../lib/health-notification-transport";
import { noticeEntries } from "../lib/health-board";

const event: SmsGatewayEvent = { id: "incident-event-a", gateway_id: "gateway-a", gateway_name: "Gateway A",
  phone_number: "+6580000001", kind: "offline", occurred_at: "2026-11-02T02:03:00Z", last_seen_at: "2026-11-02T02:01:00Z" };
const healthy: SmsGatewayHealth = { gateway_id: "gateway-a", gateway_name: "Gateway A", phone_number: "+6580000001",
  device_id: "phone-a", enabled: true, heartbeat_interval_seconds: 30, delayed_after_seconds: 45,
  critical_after_seconds: 90, startup_grace_seconds: 300, monitoring_started_at: "2026-11-02T02:00:00Z",
  last_seen_at: "2026-11-02T02:01:00Z", last_monitor_at: "2026-11-02T02:01:00Z", incident_open: false,
  status: "healthy", elapsed_seconds: 12, checked_at: "2026-11-02T02:01:12Z" };

test("gateway display identifies the exact configured phone and preserves receipt-age semantics", () => {
  assert.equal(gatewayElapsed(null), "Never received");
  assert.equal(gatewayElapsed(12), "12s ago");
  assert.equal(gatewayElapsed(241), "4m 1s ago");
  const text = smsGatewayMessage(event);
  assert.match(text, /Gateway A · \+6580000001 · gateway-a/);
  assert.match(text, /Last heartbeat received:/);
  assert.doesNotMatch(text, /powered off/);
  assert.match(smsGatewayMessage({ ...event, kind: "recovered" }), /ping reception has resumed/);
  assert.match(smsGatewayMessage({ ...event, last_seen_at: null }), /Never received/);
});

test("HALO summary uses gateway names, distinguishes unreadable evidence, and flags a missing monitor", () => {
  assert.deepEqual(smsGatewayNotices([healthy]), []);
  assert.deepEqual(smsGatewayNotices([{ ...healthy, enabled: false, status: "offline" }]), []);
  assert.equal(smsGatewayNotices(null)[0].colour, "amber");
  const offline = smsGatewayNotices([{ ...healthy, status: "offline", elapsed_seconds: 91 }]);
  assert.equal(offline[0].colour, "red");
  assert.match(noticeEntries(offline)[0].projectCode, /Gateway A · \+6580000001/);
  assert.equal(noticeEntries(offline)[0].scope, "service");
  assert.equal(smsGatewayNotices([{ ...healthy, status: "delayed" }])[0].colour, "amber");
  assert.equal(smsGatewayNotices([{ ...healthy, status: "unknown", last_seen_at: null, incident_open: true }])[0].colour, "red");
  assert.match(smsGatewayNotices([{ ...healthy, last_monitor_at: null }])[0].label, /awaiting first scheduled/);
});

test("monitor drains durable incident events and records each outcome", async () => {
  const queue: SmsGatewayEvent[] = [event, { ...event, id: "event-b", gateway_id: "gateway-b", phone_number: "+6580000002" }, { ...event, id: "recovery", kind: "recovered" }];
  const recorded: string[] = [];
  const result = await monitorSmsGateways({ evaluate: async () => 2, claim: async () => queue.shift() ?? null,
    send: async () => "queued", record: async (id, status) => { recorded.push(`${id}:${status}`); } });
  assert.deepEqual(result, { opened: 2, attempted: 3, failed: 0 });
  assert.deepEqual(recorded, ["incident-event-a:queued", "event-b:queued", "recovery:queued"]);
});

test("live gateway refresh clears old gateway findings while preserving tick and feed findings", () => {
  const old = smsGatewayNotices([{ ...healthy, status: "offline" }]);
  const tick = { id: "tick" as const, colour: "red" as const, label: "tick stopped", detail: null };
  const feed = { id: "feed" as const, colour: "amber" as const, label: "feed unavailable", detail: null };
  assert.deepEqual(mergeSmsGatewayNotices([tick, feed, ...old], [healthy]), [tick, feed]);
  const unavailable = mergeSmsGatewayNotices([tick, ...old], null);
  assert.equal(unavailable[0], tick);
  assert.equal(unavailable[1].id, "sms-gateway:coverage");
});

test("database failure stops sending; a failed send remains unconfirmed while other gateways proceed", async () => {
  let sends = 0;
  await assert.rejects(monitorSmsGateways({ evaluate: async () => { throw new Error("database unavailable"); },
    claim: async () => event, send: async () => { sends++; return "sent"; }, record: async () => {} }), /database unavailable/);
  assert.equal(sends, 0);
  const queue = [event, { ...event, id: "event-b" }];
  const outcomes: string[] = [];
  const deps = { evaluate: async () => 0, claim: async () => queue.shift() ?? null,
    send: async () => { if (++sends === 1) throw new Error("listener timeout"); return "sent"; },
    record: async (id: string, outcome: string) => { outcomes.push(`${id}:${outcome}`); } };
  assert.equal((await monitorSmsGateways(deps)).failed, 1);
  assert.deepEqual(outcomes, ["incident-event-a:unconfirmed", "event-b:sent"]);
  assert.equal((await monitorSmsGateways(deps)).attempted, 0);
});

test("machine-token guard fails closed and sender preserves queued versus delivered semantics", async () => {
  const originalToken = process.env.HALO_DATA_HEALTH_TOKEN;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.HALO_DATA_HEALTH_TOKEN;
    assert.equal(healthNotificationAuthorized({ headers: new Headers() }), false);
    process.env.HALO_DATA_HEALTH_TOKEN = "a".repeat(32);
    assert.equal(healthNotificationAuthorized({ headers: new Headers({ Authorization: `Bearer ${"a".repeat(32)}` }) }), true);
    assert.equal(healthNotificationAuthorized({ headers: new Headers({ Authorization: `Bearer ${"b".repeat(32)}` }) }), false);
    const settings = { url: "https://db.example", key: "server-key", sender: "https://listener.example/send", group: "ops@g.us",
      clientId: "client", instanceName: "instance", listenerToken: "token" };
    globalThis.fetch = async () => Response.json({ success: true, results: [{ chatId: "ops@g.us", success: true, queued: true, code: "QUEUED", queueId: "queue-1" }] });
    assert.equal(await sendHealthNotification("message", settings), "queued");
    globalThis.fetch = async () => Response.json({ success: true, results: [{ chatId: "ops@g.us", success: true, messageId: "wa-id", ack: 1 }] });
    assert.equal(await sendHealthNotification("message", settings), "sent");
    globalThis.fetch = async () => Response.json({ success: true, results: [{ chatId: "ops@g.us", success: true }] });
    await assert.rejects(sendHealthNotification("message", settings), /unconfirmed/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HALO_DATA_HEALTH_TOKEN;
    else process.env.HALO_DATA_HEALTH_TOKEN = originalToken;
  }
});

test("monitor leaves further pending events for the next minute when its request budget is spent", async () => {
  let now = 0;
  let claimed = 0;
  const result = await monitorSmsGateways({ now: () => now, evaluate: async () => 0,
    claim: async () => { claimed++; return event; },
    send: async () => { now += 11_000; return "queued"; }, record: async () => {} });
  assert.equal(result.attempted, 1);
  assert.equal(claimed, 1);
});
