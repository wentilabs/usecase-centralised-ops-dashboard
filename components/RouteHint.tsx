import { isDeliveryPlumbing, routesForField } from "@/lib/field-routes";
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
 * **One route per row.** The first version joined them with a separator, and
 * the three shared summary columns each name three endpoints — so the line
 * wrapped mid-path and `POST /api/past-days-company-safety-` ended one row
 * with `summary` starting the next. A path broken across a line break is
 * harder to read than no path at all. Each row is `nowrap`, so a path either
 * fits or overflows visibly rather than being silently cut in half.
 *
 * Nothing is rendered when the registry has nothing to say, which is most
 * labelling columns. A field with no route is better silent than captioned
 * with something vague — the absence is itself a signal that the column does
 * not steer a handler.
 */
export function RouteHint({ service, column }: { service: ServiceKey; column: string }) {
  if (isDeliveryPlumbing(column)) {
    return (
      <div
        className="text-[10px] italic leading-snug text-muted-foreground/70"
        title="Read by every route that sends a message"
      >
        ↳ every outbound route
      </div>
    );
  }

  const routes = routesForField(service, column);
  if (!routes.length) return null;

  return (
    <div className="mt-0.5 flex flex-col gap-px" title={`Read by ${routes.join(", ")}`}>
      {routes.map((route) => (
        <div key={route} className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] leading-snug text-primary/70">
          ↳ {route}
        </div>
      ))}
    </div>
  );
}
