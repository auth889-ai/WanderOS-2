import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { queryAurora } from "@/lib/db/pool";
import { getJarRecap } from "@/lib/agents/crews/memory-jar/agents/jar-recap/agent";
import { generateImage, posterUrl, jarScenePrompt, backgroundPrompt, variantPrompt } from "@/lib/agents/crews/memory-jar/media/falImage";

export const runtime = "nodejs";
export const maxDuration = 90;

type PostRow = { caption: string | null; location: string | null; media_url: string | null; created_at: string };
const VARIANT_STYLES = ["Cyberpunk", "Snowy", "Studio Ghibli"];

/** GET → the Living Memory Jar dashboard: year jars, stats, recent memory, an AI recap, and fal-generated cinematic scene + alternate realities (cached). */
export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const uid = auth.session!.id;

  await queryAurora(
    `create table if not exists jar_scenes (user_id uuid, year int, style text default 'jar', url text, created_at timestamptz default now(), primary key (user_id, year, style))`,
    []
  ).catch(() => {});

  const posts = await queryAurora<PostRow>(
    `select caption, location, media_url, created_at from travel_posts where author_id = $1 order by created_at desc limit 120`,
    [uid]
  ).catch(() => [] as PostRow[]);

  const yearMap = new Map<number, PostRow[]>();
  for (const p of posts) {
    const y = new Date(p.created_at).getFullYear();
    (yearMap.get(y) ?? yearMap.set(y, []).get(y)!).push(p);
  }
  const yearJars = [...yearMap.entries()].sort((a, b) => b[0] - a[0]).map(([year, ps]) => ({
    year, count: ps.length,
    place: ps.find((p) => p.location)?.location ?? "",
    cover: posterUrl(ps.find((p) => p.media_url)?.media_url)
  }));

  const countries = new Set(posts.map((p) => (p.location || "").split(",").pop()?.trim()).filter(Boolean));
  const recent = posts[0];
  const recentMemory = recent ? {
    place: recent.location || "A moment",
    date: new Date(recent.created_at).toLocaleDateString("en", { month: "long", year: "numeric" }),
    caption: recent.caption || "",
    image: posterUrl(recent.media_url)
  } : null;

  const latest = yearJars[0];
  const yr = latest?.year ?? new Date().getFullYear();
  const latestPosts = latest ? yearMap.get(latest.year)! : [];
  const recap = await getJarRecap({ year: yr, memories: latestPosts.map((p) => ({ caption: p.caption ?? undefined, place: p.location ?? undefined })) }).catch(() => null);

  // cinematic scene + alternate realities via fal FLUX — cached in jar_scenes (generated once per year)
  const cached = await queryAurora<{ style: string; url: string }>(`select style, url from jar_scenes where user_id = $1 and year = $2`, [uid, yr]).catch(() => []);
  const cacheMap = new Map(cached.map((c) => [c.style, c.url]));
  const place = latest?.place || recentMemory?.place;

  async function sceneFor(style: "jar" | "background" | string): Promise<string | null> {
    if (cacheMap.has(style)) return cacheMap.get(style)!;
    const prompt = style === "jar" ? jarScenePrompt({ place, topMoment: recap?.topMoment, weather: recap?.emotionalWeather })
      : style === "background" ? backgroundPrompt({ weather: recap?.emotionalWeather })
      : variantPrompt({ place }, style);
    const url = await generateImage(prompt, style === "jar" ? "portrait_4_3" : "landscape_16_9");
    if (url) await queryAurora(`insert into jar_scenes (user_id, year, style, url) values ($1,$2,$3,$4) on conflict (user_id,year,style) do update set url = $4`, [uid, yr, style, url]).catch(() => {});
    return url;
  }

  const [jarScene, background, ...variantUrls] = await Promise.all([sceneFor("jar"), sceneFor("background"), ...VARIANT_STYLES.map((s) => sceneFor(s))]);
  const variants = VARIANT_STYLES.map((style, i) => ({ style, url: variantUrls[i] }));

  const photos = posts.map((p) => posterUrl(p.media_url)).filter((u): u is string => !!u).slice(0, 6);

  return NextResponse.json({
    profile: { name: auth.session!.name, memoriesCount: posts.length, countriesCount: countries.size, cinematicCount: yearJars.length },
    yearJars, recentMemory,
    heroImage: jarScene || latest?.cover || posterUrl(recent?.media_url),
    backgroundImage: background,
    photos, variants, recap
  });
}
