import type { ReactNode } from "react";

/**
 * The operating company, as a background watermark on a project card.
 *
 * Replaces a text chip that read "Wohhup" on nearly every card — accurate, but
 * it cost a line of width to say something the eye can pick up from a shape.
 *
 * **These marks are approximations.** They are drawn from the logos as shown,
 * not from official assets, because the brand files are not in this repo. They
 * are deliberately simple and monochrome-per-brand rather than attempting a
 * faithful trademark reproduction, which would look worse the closer it tried to
 * get. To use the real thing, replace the `<g>` contents for a company below
 * with the paths from its official SVG and keep the 100×100 viewBox — nothing
 * else needs to change.
 *
 * Accessibility: a logo is not readable to anyone who does not already know it,
 * including a new joiner and a screen reader. Every mark therefore carries the
 * company name as text as well — visually hidden, but present in the accessible
 * name and in the tooltip.
 */

/** Brand colours, sampled from the marks as shown. */
const BRAND: Record<string, { primary: string; secondary: string }> = {
  Wohhup: { primary: "#A8862B", secondary: "#A8862B" },
  PentaOcean: { primary: "#0C4DA2", secondary: "#29ABE2" },
  Obayashi: { primary: "#00A651", secondary: "#4A90D9" },
};

function marksFor(company: string, colors: { primary: string; secondary: string }): ReactNode | null {
  switch (company) {
    case "Wohhup":
      // The WH monogram: two heavy uprights bridged by a peak and a crossbar.
      return (
        <g fill={colors.primary}>
          <rect x="12" y="18" width="15" height="64" />
          <rect x="73" y="18" width="15" height="64" />
          <path d="M50 14 L74 56 H62 L50 33 L38 56 H26 Z" />
          <rect x="27" y="44" width="46" height="13" />
        </g>
      );
    case "PentaOcean":
      // A pentagon of folded facets, alternating the two blues.
      return (
        <g>
          <path d="M50 10 L86 36 L72 78 H28 L14 36 Z" fill={colors.primary} opacity="0.55" />
          <path d="M50 10 L86 36 L50 48 Z" fill={colors.secondary} />
          <path d="M14 36 L50 48 L28 78 Z" fill={colors.secondary} opacity="0.85" />
          <path d="M86 36 L72 78 L50 48 Z" fill={colors.primary} />
        </g>
      );
    case "Obayashi":
      // A small blue triangle above a broad green arc.
      return (
        <g>
          <path d="M50 12 L68 32 H32 Z" fill={colors.secondary} />
          <path d="M10 78 A40 40 0 0 1 90 78 Z" fill={colors.primary} />
        </g>
      );
    default:
      return null;
  }
}

export function CompanyMark({ company }: { company: string }) {
  const colors = BRAND[company];
  const mark = colors ? marksFor(company, colors) : null;

  // An unmapped company keeps a readable text label rather than vanishing — a new
  // company should show up as itself, not as nothing.
  if (!mark) {
    return (
      <span className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {company}
      </span>
    );
  }

  return (
    <>
      <span className="sr-only">{company}</span>
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        focusable="false"
        // Centred on the card, both axes. This was pinned to the right edge,
        // which put it under the delivery chips rather than behind the card.
        className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 opacity-[0.09] md:h-32 md:w-32"
      >
        <title>{company}</title>
        {mark}
      </svg>
    </>
  );
}
