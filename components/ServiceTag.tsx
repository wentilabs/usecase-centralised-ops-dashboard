import type { CSSProperties } from "react";

import { tagLabel, type ServiceKey } from "@/lib/services";

/**
 * The per-service hue, in one place.
 *
 * The hues are spread deliberately: amber 45°, sky 200°, orange 30°, violet
 * 270°, cyan 190°, lime 85°, rose 350°. Subcon was emerald (160°), which sat
 * between cyan and sky and read as a third blue-green at 11px. Lime is the
 * widest gap left in the wheel — yellow-green, and far enough from amber's gold
 * to be told apart at a glance.
 *
 * Adding a service means picking a hue that is not already within ~30° of one
 * of these.
 *
 * Lives here rather than in ProjectCard because the canonical projects grid
 * shows the same seven services: a second copy of this table would drift, and
 * the whole point of the colour is that a service looks the same wherever you
 * meet it.
 */
const TAG_TONE: Record<ServiceKey, string> = {
  wbgt: "bg-amber-400/15 text-amber-300",
  noise: "bg-sky-400/15 text-sky-300",
  haze: "bg-orange-400/15 text-orange-300",
  lightning: "bg-violet-400/15 text-violet-300",
  ailytics: "bg-cyan-400/15 text-cyan-300",
  subcon: "bg-lime-400/15 text-lime-300",
  issueChaser: "bg-rose-400/15 text-rose-300",
};

/**
 * The same seven hues as CSS colours, for a chart.
 *
 * Here rather than in the chart for the reason above: one table, so a service
 * is the same colour wherever you meet it. These are the literal values behind
 * the Tailwind 400 shades used by the pills.
 *
 * Values rather than class names because the chart needs to DERIVE from the
 * hue — a stripe of it, a wash of it — and a class name cannot be operated on.
 * The first attempt drew the conditional layer as `opacity-30` over the dark
 * ground, which does not lighten a colour so much as drag it toward the
 * background: amber came out olive and orange came out brown, and both read as
 * an eighth and ninth service that is in no legend.
 */
export const SERVICE_COLOR: Record<ServiceKey, string> = {
  wbgt: "#fbbf24",
  noise: "#38bdf8",
  haze: "#fb923c",
  lightning: "#a78bfa",
  ailytics: "#22d3ee",
  subcon: "#a3e635",
  issueChaser: "#fb7185",
};

/**
 * How a bar segment is painted, given its service's hue.
 *
 * Scheduled is the flat colour. Conditional keeps the SAME hue at full
 * strength and separates itself by pattern instead — diagonal stripes over a
 * faint wash of the same colour. Pattern survives being made small and dark in
 * a way opacity does not, and it cannot be mistaken for another category.
 */
export function segmentStyle(service: ServiceKey, certain: boolean): CSSProperties {
  const color = SERVICE_COLOR[service];
  if (certain) return { backgroundColor: color };
  return {
    // `${color}2e` is the hue at ~18% alpha — enough to place it, not enough
    // to be confused with the solid block beside it.
    backgroundColor: `${color}2e`,
    backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0 2px, transparent 2px 6px)`,
  };
}

/**
 * A service, as the pill it wears everywhere.
 *
 * Short form because it usually sits beside a project code, where "Subcon
 * Activities" wraps onto two lines; the service tab keeps the full name.
 */
export function ServiceTag({ service, className = "", title, muted = false }: {
  service: ServiceKey;
  /** Size and spacing only — the hue is not the caller's to choose. */
  className?: string;
  title?: string;
  /**
   * The service exists but this project has no row in it.
   *
   * Drawn in the same slot, in grey: the absence is the information. A card
   * that simply omits the missing ones makes every card a different shape and
   * leaves "does this site have noise monitoring" to be answered by counting.
   */
  muted?: boolean;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        muted ? "bg-muted/30 text-muted-foreground/60" : TAG_TONE[service]
      } ${className}`}
    >
      {tagLabel(service)}
    </span>
  );
}
