import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";

// Editorial serif for Autopilot headings — self-hosted by next/font, so no
// external request at runtime.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-display",
  display: "swap"
});

export const metadata: Metadata = {
  title: "WanderOS",
  description: "Multi-agent travel operating system built on Vercel and Amazon Aurora PostgreSQL."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={playfair.variable}>{children}</body>
    </html>
  );
}
