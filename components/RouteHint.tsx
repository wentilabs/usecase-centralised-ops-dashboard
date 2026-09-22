import { EVERY_OUTBOUND_ROUTE, routeHint } from "@/lib/field-routes";
import type { ServiceKey } from "@/lib/services";

/**
 * Which endpoint this column steers, under its label.
 *
 * A newcomer can read a service's route list and read HALO's editor and still
 * not join the two: `enable_hourly` and `enable_half_hourly` sit next to each
 * other and are read by different Lambdas on different schedules, and nothing
 * in the names says so.
 *
 * Rendered in the same mono voice as the column name directly above it,
 * because it is the same kind of fact — what this field IS, rather than what
 * it means. The arrow is what separates the two lines at a glance without
 * needing a second colour.
 *
 * Nothing is rendered when the registry has nothing to say, which is most
 * labelling columns. A field with no route is better silent than captioned
 * with something vague — the absence is itself a signal that the column does
 * not steer a handler.
 */
export function RouteHint({ service, column }: { service: ServiceKey; column: string }) {
  const hint = routeHint(service, column);
  if (!hint) return null;

  const plumbing = hint === EVERY_OUTBOUND_ROUTE;
  return (
    <div
      className={`text-[10px] leading-snug ${plumbing ? "italic text-muted-foreground/70" : "font-mono text-primary/70"}`}
      // The column name above is already the machine-readable line; this is
      // the same field seen from the service's side, so it is announced rather
      // than left for a screen reader to read as a stray path.
      title={plumbing ? "Read by every route that sends a message" : `Read by ${hint}`}
    >
      ↳ {hint}
    </div>
  );
}
