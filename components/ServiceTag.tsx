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
 * A service, as the pill it wears everywhere.
 *
 * Short form because it usually sits beside a project code, where "Subcon
 * Activities" wraps onto two lines; the service tab keeps the full name.
 */
export function ServiceTag({ service, className = "", title }: {
  service: ServiceKey;
  /** Size and spacing only — the hue is not the caller's to choose. */
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONE[service]} ${className}`}
    >
      {tagLabel(service)}
    </span>
  );
}
