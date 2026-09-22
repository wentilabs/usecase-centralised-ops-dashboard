"use client";

import { Fragment, useMemo, useState } from "react";

import { SERVICE_FILL, ServiceTag } from "./ServiceTag";
import { useBackdropDismiss } from "@/lib/backdrop-dismiss";
import { dayLoad, hourDetail, hourLabel } from "@/lib/load-model";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";
import { useBodyScrollLock, useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * How much outbound traffic each hour of the day carries.
 *
 * Opens over the dashboard and costs nothing to open: every config row is
 * already in the client, so this is arithmetic on data in hand — no request, no
 * spinner, and the numbers change the instant a filter does.
 *
 * Read the model's own doc comment for what the numbers mean. The two things
 * this screen has to get across are in the legend and stay on screen: a solid
 * bar is a send that happens whatever the readings say, a faded one is the
 * worst case if they all go wrong at once, and three services are not on the
 * chart at all because nothing in a config file says when they fire.
 */
export function DeliveryLoad({
  rowsByService,
  onClose,
}: {
  rowsByService: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  onClose: () => void;
}) {
  const [hidden, setHidden] = useState<Set<ServiceKey>>(new Set());
  const [withCeiling, setWithCeiling] = useState(true);
  const [picked, setPicked] = useState<number | null>(null);

  useEscapeKey(true, onClose);
  useBodyScrollLock(true);
  const dismiss = useBackdropDismiss(true, onClose);

  const services = useMemo(() => SERVICE_KEYS.filter((key) => !hidden.has(key)), [hidden]);
  const load = useMemo(
    () => dayLoad(rowsByService, { services, includeConditional: withCeiling }),
    [rowsByService, services, withCeiling],
  );
  const detail = useMemo(
    () =>
      picked === null ? [] : hourDetail(rowsByService, picked, { services, includeConditional: withCeiling }),
    [rowsByService, picked, services, withCeiling],
  );

  // The tallest bar sets the scale. One, not zero, so an empty estate still
  // has something to measure against.
  const scale = Math.max(1, ...load.hours.map((bucket) => bucket.total));

  const toggle = (service: ServiceKey) =>
    setHidden((was) => {
      const next = new Set(was);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-background/90 p-2 backdrop-blur-sm md:p-6"
      {...dismiss}
    >
      <div className="w-full max-w-[min(1500px,97vw)] rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 md:px-6">
          <h2 className="text-base font-semibold text-foreground">Outbound load by hour</h2>
          <p className="text-xs text-muted-foreground">
            One message to one group counts as one. Singapore time, from configuration — not from what was sent.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm">
              <span className="font-semibold tabular-nums text-foreground">{load.scheduled.toLocaleString()}</span>{" "}
              <span className="text-muted-foreground">scheduled sends a day</span>
              {load.conditional > 0 ? (
                <>
                  <span className="text-muted-foreground">, up to </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {(load.scheduled + load.conditional).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground"> if every condition fires at once</span>
                </>
              ) : null}
            </p>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={withCeiling}
                onChange={(event) => setWithCeiling(event.target.checked)}
              />
              Include the conditional ceiling
            </label>

            {/* The services, as the filter. Clicking one drops it from the
                stack; the pill greys out the same way an absent service does
                on a project card. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {SERVICE_KEYS.map((service) => (
                <button key={service} type="button" onClick={() => toggle(service)} title={SERVICES[service].label}>
                  <ServiceTag service={service} muted={hidden.has(service)} />
                </button>
              ))}
            </div>
          </div>

          {/* The chart. A column per hour, stacked by service, with the
              conditional part of each stack faded — the same hue, so it reads
              as more of the same traffic rather than as another service. */}
          <div className="flex h-64 items-end gap-px md:h-72">
            {load.hours.map((bucket) => (
              <button
                key={bucket.hour}
                type="button"
                onClick={() => setPicked(picked === bucket.hour ? null : bucket.hour)}
                title={`${hourLabel(bucket.hour)} — ${bucket.total} send${bucket.total === 1 ? "" : "s"}`}
                className={`group flex h-full flex-1 flex-col justify-end rounded-t transition-colors ${
                  picked === bucket.hour ? "bg-muted/60" : "hover:bg-muted/30"
                }`}
              >
                <span
                  className={`mb-0.5 text-center text-[9px] tabular-nums ${
                    bucket.total ? "text-muted-foreground" : "text-transparent"
                  }`}
                >
                  {bucket.total || "0"}
                </span>
                {/* Sized by flex-grow rather than by a percentage height.
                    A percentage resolves against a parent with a definite
                    height, and a flex column's children have none — the first
                    version of this drew every segment at zero pixels and the
                    chart came out empty with correct numbers underneath it.

                    The spacer at the top carries the unused headroom, so every
                    column is measured against the same ceiling rather than
                    filling itself. */}
                <span className="flex w-full flex-1 flex-col justify-end">
                  <span style={{ flexGrow: Math.max(0, scale - bucket.total), flexBasis: 0 }} />
                  {SERVICE_KEYS.filter((service) => !hidden.has(service)).map((service) => {
                    const part = bucket.byService[service];
                    if (!part) return null;
                    const faded = withCeiling ? part.conditional : 0;
                    return (
                      <Fragment key={service}>
                        {faded > 0 ? (
                          <span
                            className={`${SERVICE_FILL[service]} w-full opacity-30`}
                            style={{ flexGrow: faded, flexBasis: 0, minHeight: 1 }}
                          />
                        ) : null}
                        {part.scheduled > 0 ? (
                          <span
                            className={`${SERVICE_FILL[service]} w-full`}
                            style={{ flexGrow: part.scheduled, flexBasis: 0, minHeight: 1 }}
                          />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </span>
                <span
                  className={`mt-1 text-center text-[9px] tabular-nums ${
                    picked === bucket.hour ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {String(bucket.hour).padStart(2, "0")}
                </span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Busiest hours</h3>
              {load.busiest.length ? (
                <ul className="mt-1.5 space-y-1">
                  {load.busiest.map((bucket) => (
                    <li key={bucket.hour} className="flex items-baseline gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setPicked(bucket.hour)}
                        className="font-mono tabular-nums text-primary hover:underline"
                      >
                        {hourLabel(bucket.hour)}
                      </button>
                      <span className="tabular-nums text-foreground">{bucket.total}</span>
                      <span className="text-muted-foreground">
                        send{bucket.total === 1 ? "" : "s"} · {bucket.groups} project
                        {bucket.groups === 1 ? "" : "s"} active
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Nothing is scheduled in the services shown.
                </p>
              )}

              {/* Named rather than omitted. These three are real traffic, and
                  the hours they are heaviest are exactly the ones nothing in a
                  config file can predict — so saying "not on the chart" is the
                  honest version of leaving them out. */}
              {load.ambient.length ? (
                <>
                  <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Not on the clock
                  </h3>
                  <ul className="mt-1.5 space-y-1">
                    {collapseAmbient(load.ambient).map((entry) => (
                      <li key={`${entry.service}-${entry.reason}`} className="flex items-start gap-2 text-xs">
                        <ServiceTag service={entry.service} />
                        <span className="text-muted-foreground">
                          {entry.reason}
                          {entry.groups > 0 ? (
                            <span className="text-foreground">
                              {" "}
                              — {entry.groups} destination{entry.groups === 1 ? "" : "s"} across {entry.projects}{" "}
                              project{entry.projects === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span> — {entry.projects} project{entry.projects === 1 ? "" : "s"}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>

            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {picked === null ? "Pick an hour" : `What fires at ${hourLabel(picked)}`}
              </h3>
              {picked === null ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Click a column to list every cadence in that hour, heaviest first.
                </p>
              ) : detail.length ? (
                <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto pr-1">
                  {detail.map((entry, index) => (
                    <li
                      key={`${entry.service}-${entry.projectCode}-${entry.cadence}-${index}`}
                      className="flex items-baseline gap-2 rounded px-1 py-0.5 text-xs odd:bg-muted/20"
                    >
                      <ServiceTag service={entry.service} />
                      <span className="font-medium text-foreground">{entry.projectCode}</span>
                      <span className="truncate text-muted-foreground">{entry.cadence}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-foreground">{entry.sends}</span>
                      {entry.certainty === "conditional" ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">max</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">Nothing is due at {hourLabel(picked)}.</p>
              )}
            </div>
          </div>

          <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
            A solid bar is a send that happens whatever the readings say. A faded one is the worst case for that hour
            if every condition fires at once — capacity, not a forecast. Hours come from the live EventBridge rules,
            so a cadence configured for an hour its rule never runs in is listed as never sending rather than drawn.
            Weekly rules, on-demand routes and Sunday and public-holiday mutes are left out, so this describes an
            ordinary working day. Rules that post nothing to a group — scrapes, sheet fills, retries and ingestion
            — are not counted either: they cost Lambda time, but this counts messages.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * One line per service and reason, rather than one per project.
 *
 * Thirty projects each contributing the same sentence about lightning is a
 * scrolling list that says one thing. Collapsed, it says that one thing and
 * how much of the estate it covers.
 */
function collapseAmbient(
  entries: { service: ServiceKey; projectCode: string; reason: string; groups: number }[],
): { service: ServiceKey; reason: string; groups: number; projects: number }[] {
  const byReason = new Map<string, { service: ServiceKey; reason: string; groups: number; projects: number }>();
  for (const entry of entries) {
    const key = `${entry.service}|${entry.reason}`;
    const found = byReason.get(key);
    if (found) {
      found.groups += entry.groups;
      found.projects += 1;
    } else {
      byReason.set(key, { service: entry.service, reason: entry.reason, groups: entry.groups, projects: 1 });
    }
  }
  return [...byReason.values()].sort((a, b) => b.groups - a.groups || a.service.localeCompare(b.service));
}
