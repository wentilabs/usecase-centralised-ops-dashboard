import { ServiceTag } from "./ServiceTag";
import { WhatsAppBubble } from "./WhatsAppBubble";
import {
  endpointPreviewsFor,
  projectsReceiving,
  variantsOf,
  type EndpointPreview,
} from "@/lib/endpoint-previews";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";

/**
 * "What actually lands in the group when this endpoint runs?"
 *
 * Keyed by route, because most delivering endpoints have no formatter column to
 * hang a `?` on. The same messages also sit behind the `?` beside the switch that
 * turns each one on, in the config editor; this is the view for someone holding an
 * endpoint rather than a column.
 *
 * Nothing is typed in here. Every message is lifted from a service's own document or
 * produced by its own builder (`scripts/build-endpoint-previews.mjs`), and an
 * endpoint with nothing to show says why in the service's terms rather than being
 * left off. "On for" is the configuration's answer — the project's own `enabled` and
 * every switch the endpoint needs — not an observation: a calendar or time gate can
 * still skip a given run, and the service decides that at run time.
 */
export function EndpointMessages({ rows }: { rows: Partial<Record<ServiceKey, ProjectConfigRow[]>> }) {
  return (
    <section className="flex flex-col gap-3" aria-label="What each endpoint sends">
      <header className="flex flex-col gap-1 border-b border-border pb-2">
        <h2 className="text-lg font-semibold">What each endpoint sends</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The real message behind every endpoint that delivers one, taken from each service&apos;s own message
          documents or by running its own message builder. Names, readings and times are example values; the
          layout is the service&apos;s. Open a row to read it.
        </p>
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        {SERVICE_KEYS.map((service) => {
          const entries = endpointPreviewsFor(service);
          if (!entries.length) return null;
          return (
            <article key={service} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3">
              <h3 className="flex items-center gap-2 pb-1 text-base font-semibold">
                <ServiceTag service={service} />
                <span className="text-xs font-normal text-muted-foreground">{entries.length} endpoints</span>
              </h3>
              {entries.map((entry) => (
                <EndpointRow key={entry.path} entry={entry} rows={rows[service] ?? []} />
              ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EndpointRow({ entry, rows }: { entry: EndpointPreview; rows: ProjectConfigRow[] }) {
  const receiving = projectsReceiving(entry, rows);
  const variants = variantsOf(entry);
  const intro = [...new Set(variants.map((variant) => variant.intro).filter(Boolean))];

  return (
    <details className="group rounded-lg border border-border/70 bg-background/40 open:bg-background/70">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium">{entry.title}</span>
        <span className="font-mono text-[11px] text-muted-foreground">POST {entry.path}</span>
        {entry.enabledBy === null ? (
          <span className="ml-auto rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
            no single switch
          </span>
        ) : (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
              receiving.length ? "bg-on/15 text-on ring-on/30" : "bg-muted/40 text-muted-foreground ring-border"
            }`}
          >
            {receiving.length ? `on for ${receiving.length} of ${rows.length}` : `off for all ${rows.length}`}
          </span>
        )}
      </summary>

      <div className="flex flex-col gap-2.5 border-t border-border/70 px-2.5 py-2.5 text-[13px]">
        <p className="leading-snug">{entry.summary}</p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Needs</dt>
          <dd className="flex flex-wrap gap-1">
            {entry.enabledBy === null ? (
              <span className="text-muted-foreground">
                The service documents no one switch for this, so HALO does not count projects for it.
              </span>
            ) : (
              <>
                <code className="rounded bg-muted/40 px-1 font-mono text-[11px]">enabled</code>
                {entry.enabledBy.map((rule) => (
                  <code key={rule.column} className="rounded bg-muted/40 px-1 font-mono text-[11px]">
                    {rule.column}
                    {rule.as === "text" ? " (not blank)" : ""}
                  </code>
                ))}
              </>
            )}
          </dd>
          <dt className="text-muted-foreground">Sends</dt>
          <dd>{entry.sends === "text" ? "a text message" : entry.sends === "image" ? "an image" : "a document"}</dd>
          {receiving.length ? (
            <>
              <dt className="text-muted-foreground">On for</dt>
              <dd className="font-mono text-[11px] leading-relaxed">{receiving.join(" · ")}</dd>
            </>
          ) : null}
        </dl>

        {entry.gap ? (
          <p className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
            No message to show. {entry.gap}
          </p>
        ) : null}

        {intro.map((text) => (
          <p key={text} className="text-xs leading-snug text-muted-foreground">
            {text}
          </p>
        ))}

        {variants.length ? (
          <div className="flex flex-col gap-3 rounded-lg border border-[#2a3942] bg-[#0b141a] p-3">
            {variants.map((variant, index) => (
              <div key={`${variant.column ?? "sample"}-${variant.label}-${index}`} className="flex flex-col gap-1.5">
                {variant.label ? (
                  <div className="text-[11px] text-[#8696a0]">
                    <span className="font-mono text-[#e9edef]">{variant.label}</span>
                    {variant.isFallback ? " — what a blank column uses" : ""}
                    {variant.summary ? ` · ${variant.summary}` : ""}
                  </div>
                ) : null}
                {variant.bubbles.map((bubble, bubbleIndex) => (
                  <WhatsAppBubble key={bubbleIndex} bubble={bubble} />
                ))}
                <div className="text-[10px] text-[#8696a0]">From {variant.source}.</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
