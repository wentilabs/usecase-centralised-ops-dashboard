import type { ProjectConfigRow, ServiceKey } from "../services";

/**
 * A card's outbound links.
 *
 * `internal` marks a link that is not a URL but an in-app view.
 *
 * A lightning project's map opens the evidence view rather than Google Maps,
 * because a pin on Google Maps says where the site is and nothing about whether
 * a strike qualified. A noise project's limits open the stored permissible
 * levels, which live in `noise_limits` and have no page of their own anywhere
 * else — the NoiseLynx equivalent is one meter at a time behind a login.
 */
export type CardLink = { label: string; href: string; internal?: "lightning-map" | "noise-limits" };

export function autoLinks(service: ServiceKey, config: ProjectConfigRow): CardLink[] {
  const sheet = (id: unknown) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(String(id))}/edit`;
  const links: CardLink[] = [];
  if (config.monthly_sheet_id) links.push({ label: "📗 Monthly sheet", href: sheet(config.monthly_sheet_id) });
  if (config.google_sheet_id) links.push({ label: "📗 Analysis sheet", href: sheet(config.google_sheet_id) });
  if (service === "noise") {
    // Always offered, even with no limit rows stored — "nothing is being
    // assessed against a limit" is the most important thing this view can say,
    // and hiding the link when there is nothing to show would hide exactly that.
    links.push({ label: "📏 Noise limits", href: "#", internal: "noise-limits" });
  }
  if (config.spreadsheet_id) {
    // Same column, different documents: ailytics keeps its safety log there,
    // subcon its manpower workbook. Named for the document, not for a tab —
    // subcon reads `Manpower` and no longer writes `Daily Activity` at all.
    links.push({
      label: service === "subcon" ? "📗 Manpower workbook" : "📗 Safety sheet",
      href: sheet(config.spreadsheet_id),
    });
  }
  if (config.manpower_spreadsheet_id) {
    links.push({ label: "📗 Manpower sheet", href: sheet(config.manpower_spreadsheet_id) });
  }
  if (config.safety_sheet_id) {
    links.push({ label: "📗 Safety workbook", href: sheet(config.safety_sheet_id) });
  }
  if (config.latitude && config.longitude) {
    const external = `https://www.google.com/maps?q=${encodeURIComponent(`${config.latitude},${config.longitude}`)}`;
    links.push(
      service === "lightning"
        ? // `href` is kept as the Google Maps URL so a middle-click or a
          // right-click "open in new tab" still lands somewhere sensible; the
          // click handler takes precedence and opens the evidence map.
          { label: "⚡ Lightning map", href: external, internal: "lightning-map" }
        : { label: "📍 Map", href: external },
    );
  }
  return links;
}
