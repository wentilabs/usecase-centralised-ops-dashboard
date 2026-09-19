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
 * brings the navy up without touching the logos that already read.
 */
/**
 * Per-logo corrections, and why there are two of them.
 *
 * `tweak` balances the centred watermark against dense card text. `edgeTweak`
 * balances the right-aligned mark in the registry, where the correction needed
 * is a different one: object-contain fits each file's CANVAS to the box, so how
 * large a logo LOOKS depends on how much of its own canvas the artwork fills,
 * which was measured rather than guessed —
 *
 *   wohhup      195x141 of 200x200   fills 71% of its height   103px visible
 *   pentaocean  126x 85 of 200x200   fills 43%                  62px visible
 *   soilbuild   200x120 of 200x120   fills 100%                138px visible
 *
 * — in the same 145px box. PentaOcean carries wide empty margins and read as
 * half the size of its neighbours; Soilbuild was trimmed to its artwork when it
 * was added, so it filled the box completely and read as twice. These bring all
 * three to about 105px of actual logo. Scaling clips only the empty margin,
 * which is why PentaOcean can exceed the box without losing anything.
 */
const ASSETS: Record<string, { src: string; tweak?: string; edgeTweak?: string }> = {
  // Per-logo scale, because one box means something different for each: the
  // artwork's own margins differ, so the same box leaves Wohhup looking
  // oversized and the other two looking small. Tuned by eye against the cards,
  // and these three ratios are the part worth preserving if the base box moves.
  Wohhup: { src: "/company/wohhup.png", tweak: "scale-75" },
  Obayashi: { src: "/company/obayashi.svg", tweak: "scale-125" },
  PentaOcean: { src: "/company/pentaocean.png", tweak: "brightness-[2.2] scale-125", edgeTweak: "brightness-[2.2] scale-[1.7]" },
  // The only horizontal lockup of the four: supplied as a square with a wide
  // transparent margin, trimmed to the mark and stored at its own 1.66:1, which
  // is almost exactly the box's 1.56:1. So it fills the box where the three
  // square marks have to be scaled up into it, and at full size it read as
  // twice the weight of Wohhup on the same row. 0.63 is a deliberate step down
  // from the 0.9 that merely made it a peer: the wordmark is long enough that
  // matching the others' presence still let it carry the card. Arbitrary rather
  // than a scale-* step because none lands here, the same reason brightness-[2.2]
  // is written out above. Green and gold already read on a dark card, so unlike
  // PentaOcean it needs no brightness lift.
  Soilbuild: { src: "/company/soilbuild.png", tweak: "scale-[0.63]", edgeTweak: "scale-75" },
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

/**
 * Where the mark sits in its card.
 *
 * Centred is the dashboard's watermark, sitting behind dense text. The
 * registry's cards put most of their words on the left and leave the right
 * empty, so the logo goes there instead of under the address — bigger, because
 * the space allows it, and fainter, because the further it moves from the text
 * the less it needs to hide behind.
 */
const PLACEMENT = {
  center: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  // `origin-right` matters: each logo carries its own scale tweak, and scaling
  // about the centre grows a scale-125 mark 24px past the card on each side —
  // Obayashi and PentaOcean overflowed by 46px. Scaling about the right edge
  // grows them inward instead, so every logo lines up on the same edge whatever
  // its tweak.
  right: "right-0 top-1/2 origin-right -translate-y-1/2",
} as const;

export function CompanyMark({ company, opacity = "opacity-20", box = BOX, align = "center" }: {
  company: string;
  /** Centred behind the content, or set into the card's right edge. */
  align?: keyof typeof PLACEMENT;
  /**
   * How present the mark should be. The dashboard wants a watermark behind a
   * dense card, so it keeps the default; the canonical projects grid wants the
   * logo read as the card's identity, so it asks for more. A class rather than
   * a number because Tailwind only emits the utilities it can see in source.
   */
  opacity?: string;
  /** A smaller ceiling for smaller cards; the aspect ratio is unaffected. */
  box?: string;
}) {
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
      {/* Inert, and behind the content. Without
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
        className={`pointer-events-none absolute ${PLACEMENT[align]} ${box} object-contain ${opacity} ${
          // Each alignment gets its own correction; see ASSETS. A logo with no
          // edgeTweak needs none — its artwork already fills its canvas about
          // as much as the others do once corrected.
          align === "right" ? asset.edgeTweak ?? "" : asset.tweak ?? ""
        }`}
      />
    </>
  );
}
