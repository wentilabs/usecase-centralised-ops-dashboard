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

/**
 * Company name to its file under `public/company/`, plus any per-logo tweak.
 *
 * `tweak` exists because these logos were drawn for white paper. PentaOcean's
 * wordmark is dark navy, which on a dark card at watermark opacity disappears
 * entirely — only the cyan pentagon survives, and the name is the half that
 * makes it recognisable to someone who has not seen the mark. A brightness lift
 * brings the navy up without touching the two logos that already read.
 */
const ASSETS: Record<string, { src: string; tweak?: string }> = {
  // Per-logo scale, because 70% of the card means something different for each:
  // the artwork's own margins differ, so the same box leaves Wohhup looking
  // oversized and the other two looking small. Tuned by eye against the cards.
  Wohhup: { src: "/company/wohhup.png", tweak: "scale-90" },
  Obayashi: { src: "/company/obayashi.svg", tweak: "scale-125" },
  PentaOcean: { src: "/company/pentaocean.png", tweak: "brightness-[2.2] scale-125" },
};

export function CompanyMark({ company }: { company: string }) {
  const asset = ASSETS[company];

  // An unmapped company keeps a readable text label rather than vanishing — a new
  // company should show up as itself, not as nothing.
  if (!asset) {
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
        src={asset.src}
        alt=""
        aria-hidden="true"
        draggable={false}
        // Sized as a proportion of the card rather than in fixed pixels, so it
        // scales with a card whose height varies by how many delivery groups it
        // lists. `object-contain` means the logo fits inside that box at its own
        // aspect ratio, so 70% is a ceiling on both axes, not a stretch.
        className={`pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-20 ${asset.tweak ?? ""}`}
      />
    </>
  );
}
