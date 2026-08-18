import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Centralised Services",
    template: "%s | Centralised Services",
  },
  description:
    "Project configuration control surface for the WBGT, Noise, Haze, Lightning and Ailytics alert services.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
