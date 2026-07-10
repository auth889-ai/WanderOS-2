import { embedText } from "@/lib/ai/llm";

/** The in-file jar templates (free, unlimited). Each has a rich description used for semantic matching. */
export const JAR_TEMPLATES: { id: string; label: string; desc: string }[] = [
  { id: "t0", label: "Kyoto", desc: "romantic cherry blossom Kyoto sunset, pagoda, Mount Fuji, lake, a couple on a bench, sakura, spring, pink, peaceful" },
  { id: "t1", label: "Santorini", desc: "Santorini Greece sunset, white blue-domed houses, cliff over the Aegean sea, summer, romantic, blue and white" },
  { id: "t2", label: "Paris", desc: "Paris at night, Eiffel Tower sparkling, street lamps, the Seine, autumn, city lights, romance" },
  { id: "t3", label: "Swiss Alps", desc: "snowy Swiss alps, cozy wooden chalet, pine trees, falling snow, winter, mountains, cold, serene" },
  { id: "t4", label: "Maldives", desc: "tropical Maldives beach sunset, overwater bungalow, palm trees, turquoise lagoon, summer, beach, ocean, relaxing" },
  { id: "t5", label: "Autumn", desc: "autumn Japanese maple forest, red orange leaves, red bridge, stream, lanterns, fall, cozy, nature" },
  { id: "t6", label: "Venice", desc: "Venice Italy, gondolas on a canal at dusk, palazzo lights, water reflections, romance, europe" },
  { id: "t7", label: "Desert", desc: "desert at night, golden sand dunes, glowing camp, milky way, stars, adventure, warm, solitude" },
  { id: "t8", label: "Aurora", desc: "Iceland northern lights, green purple aurora, snowy mountain, mirror lake, winter, magical, cold" },
  { id: "t9", label: "Mountain", desc: "misty mountain lake at dawn, pine forest, wooden dock, fog, calm reflection, nature, peaceful, hiking" },
  { id: "t10", label: "Tuscany", desc: "Tuscany vineyard at golden hour, rolling hills, cypress trees, stone villa, countryside, warm, wine" },
  { id: "t11", label: "New York", desc: "New York City skyline at night, Times Square neon, yellow taxis, skyscrapers, city lights, urban" },
  { id: "t12", label: "Dubai", desc: "Dubai at night, Burj Khalifa, golden skyline, desert city, luxury, modern, lights" },
  { id: "t13", label: "Bali", desc: "Bali tropical jungle, emerald rice terraces, waterfall, palm trees, green, lush, nature, asia" },
  { id: "t14", label: "Cappadocia", desc: "Cappadocia Turkey sunrise, colorful hot air balloons, fairy chimney rocks, dreamy, adventure" },
  { id: "t15", label: "London", desc: "London at night, Big Ben, the Thames, red double-decker bus, rainy, england, city" },
  { id: "t16", label: "Rome", desc: "Rome Italy, the Colosseum at golden sunset, ancient ruins, history, warm, europe" },
  { id: "t17", label: "Fjords", desc: "Norwegian fjord, red wooden village houses, green cliffs, calm water, nordic, serene, nature" },
  { id: "t18", label: "Provence", desc: "Provence France lavender fields at sunset, purple rows, farmhouse, summer, calm, romantic" },
  { id: "t19", label: "Safari", desc: "African safari savanna sunset, acacia trees, elephants, orange sky, wildlife, adventure, africa" },
  { id: "t20", label: "Beach", desc: "tropical beach at sunset, palm trees, hammock, waves, summer paradise, relaxing, ocean" },
  { id: "t21", label: "Waterfall", desc: "autumn village, forest waterfall, golden trees, cozy stone houses, nature, fall, peaceful" },
  { id: "t22", label: "Ocean", desc: "underwater coral reef, sea turtles, colorful fish, sun rays, blue ocean, diving, marine" },
  { id: "t23", label: "Camping", desc: "starry night camping by a lake, glowing tent, pine forest, milky way, stars, wilderness, adventure" },
  { id: "t24", label: "Sydney", desc: "Sydney Australia, Opera House, Harbour Bridge at sunset, sailboats, coastal, city" },
  { id: "t25", label: "Prague", desc: "Prague old town winter, Charles Bridge, snow, gothic spires, warm lamps, europe, christmas" }
];

let cache: { id: string; vec: number[] }[] | null = null;
function cos(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Free, unlimited: semantic-match the user's text to the closest in-file template (no image generation). Returns the cosine score so callers can decide template-vs-AI. */
export async function matchTemplate(text: string): Promise<{ id: string; label: string; score: number }> {
  if (!cache) cache = await Promise.all(JAR_TEMPLATES.map(async (t) => ({ id: t.id, vec: await embedText(`${t.label}. ${t.desc}`) })));
  const q = await embedText(text);
  let best = JAR_TEMPLATES[0].id, score = -2;
  for (const c of cache) { const s = cos(q, c.vec); if (s > score) { score = s; best = c.id; } }
  return { id: best, label: JAR_TEMPLATES.find((t) => t.id === best)!.label, score };
}
