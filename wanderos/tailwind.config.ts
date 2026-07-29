import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#10091f",
        grape: "#1e0f3c",
        coral: "#ef6d5b",
        peach: "#ffb08f",
        parchment: "#f3e9d9",
        mist: "#c8b8ff",
        aurora: "#67e8f9",

        // Autopilot surface system — warm editorial light theme.
        // Deep green reads as "considered/trustworthy" rather than the
        // SaaS-blue default, and warm paper keeps photos looking like photos.
        canvas: "#F2F0EA",   // page background (warm paper)
        card: "#FFFFFF",     // raised surfaces
        forest: "#2B3A26",   // primary action
        forestDeep: "#1F2B1C",
        moss: "#5A6B52",     // secondary text on green
        ink: "#1A1D19",      // headings
        slateInk: "#6B6F66", // muted body
        line: "#E3E0D7",     // hairline borders
        sand: "#EAE6DC"      // inset / track
      },
      fontFamily: {
        // Editorial serif for headings; the reference design's whole character
        // comes from this pairing.
        display: ["var(--font-display)", "Georgia", '"Times New Roman"', "serif"]
      },
      boxShadow: {
        glow: "0 24px 80px rgba(137, 92, 246, 0.26)",
        coral: "0 18px 48px rgba(239, 109, 91, 0.24)"
      }
    }
  },
  plugins: []
};

export default config;
