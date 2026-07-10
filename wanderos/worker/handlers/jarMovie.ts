import { JobHandler } from "@/lib/queue/runner";
import { queryAurora } from "@/lib/db/pool";
import { runListingVideo } from "@/lib/agents/video/orchestrator";
import { MotionRouter } from "@/lib/agents/video/providers/motion";
import { directMovie } from "@/lib/agents/crews/memory-jar/agents/movie-director/agent";
import { posterUrl } from "@/lib/agents/crews/memory-jar/media/falImage";

// tier === "cinematic" → premium (fal Kling/Veo, COSTS credits). Default "free" → Ken-Burns only (no fal, no spend).
type JarMovieInput = { movieId?: string; travelerId?: string; title?: string | null; story?: string | null; photos?: string[] | null; tier?: "free" | "cinematic" };
type PostRow = { media_url: string | null; caption: string | null; location: string | null };

/** jar_movie — turns the traveler's memory photos + story into a real cinematic film (reuses the video render pipeline). */
export const jarMovieHandler: JobHandler = async (ctx) => {
  const input = ctx.input as JarMovieInput;
  if (!input.movieId || !input.travelerId) throw new Error("jar_movie requires movieId and travelerId.");

  await ctx.reportProgress(5, "Gathering your memories");
  await ctx.throwIfCancelled();

  // source photos: explicit uploads, else the traveler's post photos (videos → poster frames)
  let photoUrls: string[] = (input.photos ?? []).map((u) => posterUrl(u)!).filter(Boolean);
  let city = "";
  let story = input.story ?? "";
  const memories: { caption?: string; place?: string }[] = [];
  if (!photoUrls.length) {
    const rows = await queryAurora<PostRow>(
      `select media_url, caption, location from travel_posts where author_id = $1 order by created_at desc limit 12`,
      [input.travelerId]
    );
    photoUrls = rows.map((r) => posterUrl(r.media_url)).filter((u): u is string => !!u).slice(0, 8);
    city = rows.find((r) => r.location)?.location ?? "";
    if (!story) story = rows.map((r) => r.caption).filter(Boolean).slice(0, 6).join(". ");
    memories.push(...rows.map((r) => ({ caption: r.caption ?? undefined, place: r.location ?? undefined })));
  } else if (story) {
    memories.push({ caption: story });
  }
  if (photoUrls.length < 2) throw new Error("Need at least 2 photos to make a movie — add some travel posts or upload photos.");

  // 🎬 movie-director (FREE Gemini) — the celebrity "Starring You" framing
  await ctx.reportProgress(12, "🎬 Directing your movie");
  const [user] = await queryAurora<{ name: string }>(`select name from users where id = $1`, [input.travelerId]);
  const firstName = (user?.name || "You").trim().split(/\s+/)[0];
  const year = new Date().getFullYear();
  const direction = await directMovie({ name: firstName, year, memories }).catch(() => null);

  await ctx.throwIfCancelled();
  // CREDIT GATE: only the explicit "cinematic" tier uses paid fal/Veo motion. Default is free Ken-Burns.
  const cinematic = input.tier === "cinematic";
  const result = await runListingVideo({
    brief: { mode: "social_reel", resolution: "1080p", photoUrls, narration: direction?.narrationHint || story || undefined, musicMood: direction?.emotion ? `${direction.emotion}, cinematic, emotional` : "uplifting cinematic" },
    listingTitle: direction?.title || input.title || "My Travel Movie",
    city,
    narrate: true,
    router: cinematic ? MotionRouter.premium() : MotionRouter.budget(),
    introCard: { title: direction?.title || `A ${year} Film`, subtitle: direction?.starringLine || `Starring ${firstName}` },
    outroCard: { title: direction?.creditLine || `Directed by ${firstName}`, subtitle: `A WanderOS Memory · ${year}` },
    cinematicGrade: true, // 2c — teal-orange film grade (free, FFmpeg)
    onProgress: (stage, detail) => {
      const map: Record<string, [number, string]> = {
        planning: [15, "🎬 Directing your movie"],
        agent: [22, "✍️ Writing the story"],
        narration: [40, "🗣 Recording narration"],
        rendering: [55, `🎥 Animating scene ${detail?.shot ?? ""}${detail?.of ? `/${detail.of}` : ""}`],
        composing: [82, "🎞 Editing the cut"],
        publishing: [92, "✨ Finalizing your film"],
        ready: [99, "Almost there"]
      };
      const [pct, label] = map[stage] ?? [50, "Rendering"];
      void ctx.reportProgress(pct, label);
    }
  });

  await queryAurora(
    `update memory_movies set status='ready', title=$2, film_url=$3, thumb_url=$4, duration_sec=$5, cost_cents=$6, updated_at=now() where id=$1`,
    [input.movieId, direction?.title || result.title, result.url, result.thumbnailUrl, Math.round(result.durationSec), result.costCents]
  ).catch(() => {});

  return { movieId: input.movieId, filmUrl: result.url, thumbnailUrl: result.thumbnailUrl, durationSec: result.durationSec };
};
