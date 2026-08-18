import type { Metadata } from "next";
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
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
