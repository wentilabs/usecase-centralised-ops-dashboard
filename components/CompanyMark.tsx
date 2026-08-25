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
  // Per-logo scale, because one box means something different for each: the
  // artwork's own margins differ, so the same box leaves Wohhup looking
  // oversized and the other two looking small. Tuned by eye against the cards,
  // and these three ratios are the part worth preserving if the base box moves.
  Wohhup: { src: "/company/wohhup.png", tweak: "scale-75" },
  Obayashi: { src: "/company/obayashi.svg", tweak: "scale-125" },
  PentaOcean: { src: "/company/pentaocean.png", tweak: "brightness-[2.2] scale-125" },
};

/**
 * The base box every logo is fitted into, in pixels rather than as a share of
 * the card.
 *
 * It was 70% × 70% of the card, which made the watermark grow with the number
 * of delivery groups a project lists — cards on one screen range from 257px to
 * 527px tall, so the same logo appeared at two noticeably different sizes and
 * read as inconsistent rather than as a background.
 *
 * 250 × 160 is sized against the *shortest* card: the largest tweak is
 * scale-125, giving 312 × 200, which still sits inside a 404 × 257 card. Raising
 * this would spill the mark past a short card's edge, because the card is
 * `relative` without `overflow-hidden`.
 */
const BOX = "h-[160px] w-[250px]";

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
        // A fixed box, centred on the card. `object-contain` means the logo
        // fits inside it at its own aspect ratio, so BOX is a ceiling on both
        // axes rather than a stretch.
        className={`pointer-events-none absolute left-1/2 top-1/2 ${BOX} -translate-x-1/2 -translate-y-1/2 object-contain opacity-20 ${asset.tweak ?? ""}`}
      />
    </>
  );
}
