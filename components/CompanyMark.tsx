/**
 * The operating company, as a watermark behind a project card.
 *
 * Replaces a text chip that read "Wohhup" on nearly every card — accurate, but it
 * cost a line of width to say something a logo says at a glance.
 *
 * The **wordmark is kept** deliberately rather than cropping to the symbol.
 * Someone who has not seen these logos before can still read who a site belongs
 * to, which a bare monogram would not give them.
 *
 * Assets live in `public/company/` and are referenced by file rather than
 * inlined, so replacing one is dropping in a new file with no code change.
 * Extensions vary because the supplied artwork does, and `ASSETS` is the only
 * place that knows which is which.
 */

/** Company name to its file under `public/company/`. */
const ASSETS: Record<string, string> = {
  Wohhup: "/company/wohhup.png",
  Obayashi: "/company/obayashi.svg",
  PentaOcean: "/company/pentaocean.png",
};

export function CompanyMark({ company }: { company: string }) {
  const src = ASSETS[company];

  // An unmapped company keeps a readable text label rather than vanishing — a new
  // company should show up as itself, not as nothing.
  if (!src) {
    return (
      <span className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {company}
      </span>
    );
  }

  return (
    <>
      <span className="sr-only">{company}</span>
      {/* Centred on both axes, inert, and behind the content. Without
          pointer-events-none it would sit over the whole card and swallow every
          click on Edit and the group links. `object-contain` keeps each logo's
          own aspect ratio — the three supplied files are not the same shape. */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-40 -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.10] md:h-28 md:w-48"
      />
    </>
  );
}
