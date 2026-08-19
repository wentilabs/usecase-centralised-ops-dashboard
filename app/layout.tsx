import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const faviconUrl = "/logos/wentilabs-favicon.png";

export const metadata: Metadata = {
  title: {
    default: "HALO Centralised Services",
    template: "%s | HALO Centralised Services",
  },
  description:
    "Project configuration control surface for the WBGT, Noise, Haze, Lightning and Ailytics alert services.",
  icons: {
    icon: [{ url: faviconUrl }],
    shortcut: [{ url: faviconUrl }],
    apple: [{ url: faviconUrl }],
  },
  appleWebApp: { capable: true, title: "HALO", statusBarStyle: "black-translucent" },
};

/**
 * Without this, mobile Safari assumes a 980px desktop viewport and renders the
 * whole dashboard zoomed out. `viewportFit: "cover"` lets the sticky header and
 * sheet footers extend into the notch/home-bar area, which the safe-area
 * padding in globals.css then compensates for.
 *
 * User zoom is deliberately left enabled (no maximumScale) — operators need to
 * pinch into project codes and group ids.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e1420",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
