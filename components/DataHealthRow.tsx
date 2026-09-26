import { formatSgt } from "@/lib/card-summary";
import { healthBadge, type DeliveryOutcome, type HealthTone, type ProjectHealth } from "@/lib/data-health";

function toneClass(tone: HealthTone) {
  return tone === "good" ? "bg-on/15 text-on ring-on/30" : tone === "warn" ? "bg-warn/15 text-warn ring-warn/30" : tone === "danger" ? "bg-danger/15 text-danger ring-danger/30" : "bg-muted text-muted-foreground ring-border";
}

export function DataHealthRow({
  health,
  delivery = "not_monitored",
}: {
  health?: ProjectHealth;
  delivery?: DeliveryOutcome;
}) {
  const deliveryBadge = healthBadge(delivery);
  const dataTone: HealthTone = health?.tone ?? "neutral";
  const dataLabel = health?.label ?? "Data: not yet covered";
  return (
    <section className="relative z-10 border-t border-border pt-2.5" aria-label="Data health">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Data health</div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${toneClass(dataTone)}`}>{dataLabel}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${toneClass(deliveryBadge.tone)}`}>{deliveryBadge.label}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Monitoring is automatic.{health?.newestReceivedAt ? ` Latest receipt ${formatSgt(health.newestReceivedAt)} SGT.` : " This service is not yet covered by the pilot."}
      </p>
    </section>
  );
}
