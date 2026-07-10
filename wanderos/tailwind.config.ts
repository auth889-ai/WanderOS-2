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
        aurora: "#67e8f9"
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
