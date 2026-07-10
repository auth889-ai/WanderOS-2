import type { Spread, Page, Layer } from "@/lib/memory/types";
import { PAGE_W, PAGE_H } from "@/lib/memory/types";

/** Theme → paper background + accent. Mirrors the crew's theme enum. */
const THEME: Record<string, { bg: string; ink: string; accent: string; script: string }> = {
  vintage: { bg: "radial-gradient(circle at 30% 20%,#f8efd9,#ecdcbd 70%,#e3cfa8)", ink: "#4a3a26", accent: "#a9762f", script: "'Georgia',serif" },
  "cherry-blossom": { bg: "radial-gradient(circle at 70% 15%,#fdeaef,#f6d3de 70%,#efbecd)", ink: "#5e3540", accent: "#d96a8a", script: "'Georgia',serif" },
  "whimsical-dream": { bg: "radial-gradient(circle at 25% 25%,#f0e7fc,#e2d3f6 70%,#d3bff0)", ink: "#42345e", accent: "#8d63cf", script: "'Georgia',serif" },
  "sunset-coast": { bg: "radial-gradient(circle at 75% 20%,#fde7d3,#f8cfa9 70%,#f3bb8b)", ink: "#5a3622", accent: "#e07a39", script: "'Georgia',serif" },
  "mono-minimal": { bg: "linear-gradient(135deg,#f7f6f4,#efeeec)", ink: "#2b2b2b", accent: "#9a8f86", script: "'Georgia',serif" },
  ocean: { bg: "radial-gradient(circle at 30% 20%,#e4f1f7,#c8e2ee 70%,#aed4e4)", ink: "#1f3a4a", accent: "#2f7fa6", script: "'Georgia',serif" },
  forest: { bg: "radial-gradient(circle at 70% 20%,#e9f0df,#d2e3c2 70%,#bcd6a6)", ink: "#2c3d24", accent: "#5a8038", script: "'Georgia',serif" },
  rosegold: { bg: "radial-gradient(circle at 30% 20%,#fbe9e4,#f4d2c8 70%,#eebcae)", ink: "#5a3a34", accent: "#c77b66", script: "'Georgia',serif" },
  midnight: { bg: "radial-gradient(circle at 30% 20%,#2a2438,#1d1830 70%,#15111f)", ink: "#ece4f5", accent: "#b79be0", script: "'Georgia',serif" },
  kraft: { bg: "radial-gradient(circle at 30% 20%,#e9d8bd,#dcc6a3 70%,#cdb389)", ink: "#46361f", accent: "#8a6a36", script: "'Georgia',serif" }
};

/** All selectable themes (for the editor color picker). */
export const MEMORY_THEMES = ["vintage", "cherry-blossom", "whimsical-dream", "sunset-coast", "mono-minimal", "ocean", "forest", "rosegold", "midnight", "kraft"] as const;
export const THEME_SWATCH: Record<string, string> = {
  vintage: "#ecdcbd", "cherry-blossom": "#f6d3de", "whimsical-dream": "#e2d3f6", "sunset-coast": "#f8cfa9", "mono-minimal": "#eeedea",
  ocean: "#c8e2ee", forest: "#d2e3c2", rosegold: "#f4d2c8", midnight: "#2a2438", kraft: "#dcc6a3"
};

function LayerView({ layer, ink, accent, script }: { layer: Layer; ink: string; accent: string; script: string }) {
  const box: React.CSSProperties = {
    position: "absolute", left: layer.x, top: layer.y, width: layer.w, height: layer.h,
    transform: `rotate(${layer.rotation || 0}deg)`, transformOrigin: "center"
  };

  if (layer.kind === "photo") {
    const v = layer.variant;
    if (v === "polaroid") {
      return (
        <div style={{ ...box, background: "#fff", padding: "14px 14px 46px", boxShadow: "0 10px 26px rgba(0,0,0,.18)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={layer.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      );
    }
    if (v === "full-bleed") {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={layer.src} alt="" style={{ ...box, objectFit: "cover", borderRadius: 8 }} />;
    }
    return (
      <div style={{ ...box, background: "#fff", padding: 10, boxShadow: "0 8px 22px rgba(0,0,0,.16)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={layer.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  if (layer.kind === "sticker") {
    return <div style={{ ...box, fontSize: Math.round(layer.h * 0.72), lineHeight: `${layer.h}px`, textAlign: "center" }}>{layer.text}</div>;
  }

  if (layer.kind === "decoration") {
    // washi / tape strip
    return <div style={{ ...box, background: `${accent}55`, borderRadius: 4, height: Math.min(layer.h, 34) }} />;
  }

  // text
  const role = layer.role;
  const style: React.CSSProperties = { ...box, color: ink, fontFamily: script, overflow: "hidden", padding: 4 };
  if (role === "title") return <div style={{ ...style, fontSize: 56, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0.5 }}>{layer.text}</div>;
  if (role === "date") return <div style={{ ...style, fontSize: 22, letterSpacing: 4, textTransform: "uppercase", color: accent }}>{layer.text}</div>;
  if (role === "quote") return <div style={{ ...style, fontSize: 34, fontStyle: "italic", lineHeight: 1.3, color: accent, textAlign: "center" }}>{layer.text}</div>;
  if (role === "photo-caption") return <div style={{ ...style, fontSize: layer.variant === "polaroid" ? 17 : 18, fontStyle: "italic", lineHeight: 1.25, textAlign: "center", color: layer.variant === "polaroid" ? "#5a4a38" : accent }}>{layer.text}</div>;
  if (role === "caption") return <div style={{ ...style, fontSize: 22, fontStyle: "italic", lineHeight: 1.4 }}>{layer.text}</div>;
  return <div style={{ ...style, fontSize: 26, lineHeight: 1.55 }}>{layer.text}</div>; // story/body
}

/** One full page (900×1200, position:relative). Reused by the spread renderer AND the flipbook. */
export function PageContent({ page, theme = "vintage" }: { page: Page; theme?: string }) {
  const t = THEME[theme] ?? THEME.vintage;
  return (
    <div style={{ width: PAGE_W, height: PAGE_H, background: t.bg, position: "relative", overflow: "hidden", boxShadow: "inset 0 0 80px rgba(0,0,0,.05)" }}>
      {page.layers.map((l) => <LayerView key={l.id} layer={l} ink={t.ink} accent={t.accent} script={t.script} />)}
    </div>
  );
}

/** Renders one two-page spread at a given scale (page coords = 900×1200). */
export function SpreadRenderer({ spread, theme = "vintage", scale = 0.5 }: { spread: Spread; theme?: string; scale?: number }) {
  const W = PAGE_W * 2, H = PAGE_H;
  return (
    <div style={{ width: W * scale, height: H * scale }} className="overflow-hidden rounded-lg shadow-2xl">
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", display: "flex" }}>
        <PageContent page={spread.leftPage} theme={spread.theme || theme} />
        <div style={{ width: 2, background: "rgba(0,0,0,.12)" }} />
        <PageContent page={spread.rightPage} theme={spread.theme || theme} />
      </div>
    </div>
  );
}
