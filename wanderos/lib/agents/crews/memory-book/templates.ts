/**
 * Spread templates — the "no garbage layout" core. The AI only PICKS a template key and ASSIGNS content
 * to named slots; the deterministic composer fills each slot's exact {x,y,w,h,rotation} in 900×1200 page
 * coords. The AI never invents geometry, so spreads always look designed.
 */
export const PAGE_W = 900;
export const PAGE_H = 1200;

export type SlotKind = "photo" | "text";
export type Slot = {
  kind: SlotKind;
  role: string;          // title | story | caption | hero | wide | photo | quote | date
  x: number; y: number; w: number; h: number;
  rotation?: number;
  variant?: string;      // photo: polaroid|framed|full-bleed · text: title|body|quote|date
};
export type SpreadTemplate = {
  key: string;
  label: string;
  photoSlots: number;    // how many photo slots across both pages
  left: Slot[];
  right: Slot[];
};

export const SPREAD_TEMPLATES: Record<string, SpreadTemplate> = {
  "title-page": {
    key: "title-page", label: "Title page", photoSlots: 1,
    left: [
      { kind: "text", role: "title", variant: "title", x: 90, y: 200, w: 720, h: 220 },
      { kind: "text", role: "date", variant: "date", x: 90, y: 440, w: 720, h: 80 },
      { kind: "text", role: "story", variant: "body", x: 90, y: 560, w: 720, h: 520 }
    ],
    right: [
      { kind: "photo", role: "hero", variant: "full-bleed", x: 40, y: 90, w: 820, h: 1020 }
    ]
  },
  "hero-left": {
    key: "hero-left", label: "Hero + story", photoSlots: 2,
    left: [
      { kind: "text", role: "title", variant: "title", x: 90, y: 110, w: 720, h: 180 },
      { kind: "photo", role: "hero", variant: "framed", x: 90, y: 320, w: 720, h: 760 }
    ],
    right: [
      { kind: "photo", role: "wide", variant: "framed", x: 60, y: 90, w: 780, h: 480 },
      { kind: "text", role: "story", variant: "body", x: 60, y: 620, w: 780, h: 460 }
    ]
  },
  "grid-3": {
    key: "grid-3", label: "Three photos + caption", photoSlots: 3,
    left: [
      { kind: "text", role: "title", variant: "title", x: 80, y: 110, w: 740, h: 150 },
      { kind: "photo", role: "photo", variant: "framed", x: 80, y: 300, w: 740, h: 760 }
    ],
    right: [
      { kind: "photo", role: "photo", variant: "framed", x: 60, y: 90, w: 780, h: 470 },
      { kind: "photo", role: "photo", variant: "framed", x: 60, y: 600, w: 520, h: 470 },
      { kind: "text", role: "caption", variant: "body", x: 610, y: 600, w: 230, h: 470 }
    ]
  },
  "polaroid-scatter": {
    key: "polaroid-scatter", label: "Polaroid scatter", photoSlots: 4,
    left: [
      { kind: "text", role: "title", variant: "title", x: 80, y: 110, w: 740, h: 150 },
      { kind: "photo", role: "photo", variant: "polaroid", x: 90, y: 320, w: 420, h: 460, rotation: -6 },
      { kind: "photo", role: "photo", variant: "polaroid", x: 430, y: 620, w: 420, h: 460, rotation: 5 }
    ],
    right: [
      { kind: "photo", role: "photo", variant: "polaroid", x: 70, y: 140, w: 440, h: 480, rotation: 4 },
      { kind: "photo", role: "photo", variant: "polaroid", x: 420, y: 560, w: 420, h: 460, rotation: -5 },
      { kind: "text", role: "quote", variant: "quote", x: 80, y: 1000, w: 740, h: 140 }
    ]
  },
  "full-bleed-quote": {
    key: "full-bleed-quote", label: "Full photo + quote", photoSlots: 1,
    left: [
      { kind: "photo", role: "hero", variant: "full-bleed", x: 40, y: 90, w: 820, h: 1020 }
    ],
    right: [
      { kind: "text", role: "title", variant: "title", x: 90, y: 260, w: 720, h: 180 },
      { kind: "text", role: "quote", variant: "quote", x: 90, y: 500, w: 720, h: 240 },
      { kind: "text", role: "story", variant: "body", x: 90, y: 780, w: 720, h: 320 }
    ]
  },
  "journal-2col": {
    key: "journal-2col", label: "Journal spread", photoSlots: 2,
    left: [
      { kind: "text", role: "title", variant: "title", x: 90, y: 120, w: 720, h: 160 },
      { kind: "text", role: "story", variant: "body", x: 90, y: 320, w: 720, h: 560 },
      { kind: "photo", role: "photo", variant: "framed", x: 90, y: 910, w: 720, h: 200 }
    ],
    right: [
      { kind: "photo", role: "hero", variant: "framed", x: 60, y: 120, w: 780, h: 720 },
      { kind: "text", role: "caption", variant: "body", x: 60, y: 880, w: 780, h: 220 }
    ]
  },
  // "Sky-High Dreams" style — a pinned polaroid + title/date/story on the left, a repeated header
  // + a large framed scene on the right (its caption auto-renders below).
  "feature-journal": {
    key: "feature-journal", label: "Featured polaroid + journal", photoSlots: 2,
    left: [
      { kind: "photo", role: "photo", variant: "polaroid", x: 210, y: 100, w: 480, h: 470, rotation: -4 },
      { kind: "text", role: "title", variant: "title", x: 120, y: 612, w: 660, h: 110 },
      { kind: "text", role: "date", variant: "date", x: 120, y: 732, w: 660, h: 48 },
      { kind: "text", role: "story", variant: "body", x: 120, y: 800, w: 680, h: 350 }
    ],
    right: [
      { kind: "text", role: "title", variant: "title", x: 90, y: 96, w: 720, h: 100 },
      { kind: "text", role: "date", variant: "date", x: 90, y: 206, w: 720, h: 46 },
      { kind: "photo", role: "hero", variant: "framed", x: 90, y: 286, w: 720, h: 480 }
    ]
  }
};

export const TEMPLATE_KEYS = Object.keys(SPREAD_TEMPLATES);

export const THEMES = ["vintage", "cherry-blossom", "whimsical-dream", "sunset-coast", "mono-minimal"] as const;
export type Theme = (typeof THEMES)[number];
