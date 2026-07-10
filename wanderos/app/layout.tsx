import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WanderOS",
  description: "Multi-agent travel operating system built on Vercel and Amazon Aurora PostgreSQL."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
