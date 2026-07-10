import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runVideoCrew, type CrewShot } from "./crew";
import { MotionRouter } from "./providers/motion";
import { GeminiTTSProvider } from "./providers/tts";
import { LibraryMusicProvider } from "./providers/music";
import { composite, buildVoiceTrack, probeDuration, titleCardClip, synthMusicBed } from "../../media/video/ffmpeg";
import { uploadVideo } from "../../media/video/cloudinaryVideo";
import { RES, type VideoBrief } from "./types";

/**
 * VideoOrchestrator — the render state machine (docs/VIDEO_HLD.md §4). Vision-grounded crew flow:
 *   storyboard(sees photos → per-shot narration/caption) → per-shot TTS → motion render
 *   → per-shot SYNCED voice track → compose(crossfades·captions·voice·music·HD) → publish(Cloudinary)
 * Length scales with content; voice always describes the room on screen.
 */
const TRANSITION = 0.6;
type Progress = (stage: string, detail?: Record<string, unknown>) => void;

export interface VideoResult {
  title: string;
  url: string;
  thumbnailUrl: string;
  durationSec: number;
  costCents: number;
  manifest: { shots: (CrewShot & { provider: string; durationSec: number })[] };
}

export async function runListingVideo(input: {
  brief: VideoBrief;
  listingTitle?: string;
  city?: string;
  router?: MotionRouter;
  narrate?: boolean; // Category 1 = true (narrated tour) · Category 2 = false (cinematic reel, music only)
  onProgress?: Progress;
  introCard?: { title: string; subtitle?: string }; // override the title sequence (e.g. a memory movie "Starring You")
  outroCard?: { title: string; subtitle?: string };
  cinematicGrade?: boolean; // apply the teal-orange film grade (memory movie)
}): Promise<VideoResult> {
  const progress = input.onProgress ?? (() => {});
  const narrate = input.narrate !== false;
  const { w, h } = RES[input.brief.resolution];
  const router = input.router ?? MotionRouter.premium();
  const workDir = mkdtempSync(join(tmpdir(), "wanderos-video-"));
  let cost = 0;

  try {
    // 1) the CREW — shot-vision → mode-director → narration-writer → caption-writer
    progress("planning");
    const story = await runVideoCrew({
      photoUrls: input.brief.photoUrls,
      mode: input.brief.mode,
      narrate,
      hostNarration: input.brief.narration,
      listingTitle: input.listingTitle,
      city: input.city,
      onAgent: (agent) => progress("agent", { agent })
    });
    const shots = story.shots.filter((s) => s.photoIndex >= 0 && s.photoIndex < input.brief.photoUrls.length);
    if (!shots.length) throw new Error("crew produced no usable shots");

    // 2) per-shot TTS (Category 1) — so each shot is sized to fit its narration (sync + natural length)
    const voiceSegs: ({ path: string; durationSec: number } | null)[] = [];
    if (narrate) {
      progress("narration", { shots: shots.length });
      const tts = new GeminiTTSProvider();
      for (let i = 0; i < shots.length; i++) {
        const v = await tts.synthesize(shots[i].narration, join(workDir, `voice-${i}.m4a`));
        voiceSegs.push({ path: v.path, durationSec: v.durationSec });
        cost += v.costCents;
      }
    } else {
      shots.forEach(() => voiceSegs.push(null));
    }
    const targetDur = (i: number) => (voiceSegs[i] ? Math.min(9, Math.max(4.5, voiceSegs[i]!.durationSec + 0.8)) : 5);

    // 3) motion render per shot
    const clips: { path: string; durationSec: number; caption?: string }[] = [];
    const manifestShots: VideoResult["manifest"]["shots"] = [];
    for (let i = 0; i < shots.length; i++) {
      progress("rendering", { shot: i + 1, of: shots.length, room: shots[i].room });
      const clip = await router.render(
        { i, photoUrl: input.brief.photoUrls[shots[i].photoIndex], photoHash: "", motionPrompt: shots[i].motionPrompt, durationSec: targetDur(i) },
        { mode: input.brief.mode, resolution: input.brief.resolution, workDir }
      );
      cost += clip.costCents;
      clips.push({ path: clip.path, durationSec: clip.durationSec, caption: shots[i].caption });
      manifestShots.push({ ...shots[i], provider: clip.provider, durationSec: clip.durationSec });
    }

    // 4) intro + outro title cards (produced feel)
    progress("composing");
    const introDur = 2.8, outroDur = 2.6;
    const intro = join(workDir, "intro.mp4");
    const outro = join(workDir, "outro.mp4");
    await titleCardClip({ title: input.introCard?.title || story.title || input.listingTitle || "Your Stay", subtitle: input.introCard?.subtitle ?? [input.city, input.brief.mode.replace(/_/g, " ")].filter(Boolean).join("  ·  "), out: intro, w, h, dur: introDur, workDir });
    await titleCardClip({ title: input.outroCard?.title || "Book your stay", subtitle: input.outroCard?.subtitle ?? (input.listingTitle || input.city || "WanderOS"), out: outro, w, h, dur: outroDur, workDir });

    // 5) timeline = intro + room shots + outro (cards carry no narration)
    type Tl = { path: string; durationSec: number; caption?: string; voicePath?: string; voiceDur?: number };
    const timeline: Tl[] = [
      { path: intro, durationSec: introDur },
      ...clips.map((c, i) => ({ path: c.path, durationSec: c.durationSec, caption: c.caption, voicePath: voiceSegs[i]?.path, voiceDur: voiceSegs[i]?.durationSec })),
      { path: outro, durationSec: outroDur }
    ];

    // 6) synced voice track — each narration starts at its shot, but NEVER before the previous narration
    //    has finished (prevents voice overlap when a clip is capped shorter than its narration).
    const GAP = 0.25; // breath between lines
    let cursor = 0, lastVoiceEnd = 0;
    const segs: { path: string; startSec: number }[] = [];
    for (const t of timeline) {
      if (t.voicePath) {
        const segStart = Math.max(cursor, lastVoiceEnd + GAP);
        segs.push({ path: t.voicePath, startSec: segStart });
        lastVoiceEnd = segStart + (t.voiceDur ?? t.durationSec);
      }
      cursor += t.durationSec - TRANSITION;
    }
    const totalDur = timeline.reduce((a, t) => a + t.durationSec, 0) - (timeline.length - 1) * TRANSITION;
    const voiceTrack = await buildVoiceTrack(segs, totalDur, join(workDir, "voice.m4a"));

    // 7) music: royalty-free library track, else a soft synthesized bed
    const lib = await new LibraryMusicProvider().pick(input.brief.mode, input.brief.musicMood ?? story.musicMood);
    let musicPath = lib?.path;
    if (!musicPath) { const bed = join(workDir, "music.m4a"); await synthMusicBed(totalDur, bed); musicPath = bed; }

    // 8) compose
    const out = join(workDir, "final.mp4");
    await composite({ clips: timeline.map((t) => ({ path: t.path, durationSec: t.durationSec, caption: t.caption })), out, w, h, workDir, voicePath: voiceTrack ?? undefined, musicPath, grade: input.cinematicGrade });

    // 7) publish
    progress("publishing");
    const pub = await uploadVideo(out);
    progress("ready", { url: pub.url });
    return {
      title: story.title,
      url: pub.url,
      thumbnailUrl: pub.thumbnailUrl,
      durationSec: pub.durationSec || probeDuration(out),
      costCents: cost,
      manifest: { shots: manifestShots }
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
