import { spawn, spawnSync } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";

/**
 * FFmpeg primitives for the listing-video compositor.
 *   kenBurnsClip — pan/zoom motion on a still ($0 fallback)
 *   composite    — stitch clips with crossfades, burn captions, lay voice over ducked music, encode HD
 * Multi-pass (normalize → xfade+captions visual → audio mix) for reliability over one giant filtergraph.
 */

export function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))));
  });
}

export function probeDuration(path: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" });
  return parseFloat((r.stdout || "0").trim()) || 0;
}

export async function download(url: string, dest: string): Promise<void> {
  if (url.startsWith("data:")) {
    const b64 = url.slice(url.indexOf(",") + 1);
    await writeFile(dest, Buffer.from(b64, "base64"));
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}: ${url.slice(0, 80)}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Ken-Burns pan/zoom clip from a still image (cost-free motion). */
export async function kenBurnsClip(imgPath: string, out: string, dur: number, w: number, h: number): Promise<void> {
  await run([
    "-y", "-loop", "1", "-i", imgPath,
    "-vf",
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0010,1.35)':d=${Math.round(dur * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=25,format=yuv420p`,
    "-t", String(dur), "-r", "25", "-an", out
  ]);
}

const escXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!)).slice(0, 110);

/** Render a caption as a full-frame transparent PNG (lower-third pill) via sharp — portable, no drawtext. */
async function makeCaptionPng(text: string, w: number, h: number, out: string): Promise<void> {
  const sharp = (await import("sharp")).default;
  const fs = Math.round(h / 22);
  const padX = Math.round(fs * 0.9);
  const boxW = Math.min(w - 80, Math.round(text.length * fs * 0.56) + padX * 2);
  const boxH = Math.round(fs * 2.1);
  const boxX = Math.round((w - boxW) / 2);
  const boxY = Math.round(h - boxH - h / 10);
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${Math.round(boxH / 4)}" fill="black" fill-opacity="0.5"/>
    <text x="${w / 2}" y="${boxY + boxH / 2}" font-family="Arial, Helvetica, sans-serif" font-size="${fs}" font-weight="700"
          fill="white" text-anchor="middle" dominant-baseline="central">${escXml(text)}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}

/** Build the visual: normalize each clip, crossfade-chain them, overlay per-shot caption PNGs. → silent mp4 */
// cinematic film grade — teal-orange, gentle contrast/saturation, vignette + film grain. Memory-movie only.
const FILM_GRADE = "eq=contrast=1.10:saturation=1.16:gamma=0.97,colorbalance=rs=-0.06:bs=0.06:rh=0.05:bh=-0.05,vignette=angle=PI/4.5,noise=alls=5:allf=t";

async function buildVisual(
  clips: { path: string; durationSec: number; caption?: string }[],
  out: string, w: number, h: number, workDir: string, transition = 0.6, grade = false
): Promise<void> {
  const total = clips.reduce((a, c) => a + c.durationSec, 0) - (clips.length - 1) * transition;
  const inputs: string[] = [];
  clips.forEach((c) => inputs.push("-i", c.path));

  // caption PNG inputs (looped for the whole video, shown only during each shot's window via overlay enable)
  const caps: { idx: number; s: string; e: string }[] = [];
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.caption) {
      const png = join(workDir, `cap-${i}.png`);
      await makeCaptionPng(c.caption, w, h, png);
      caps.push({ idx: clips.length + caps.length, s: (start + 0.3).toFixed(2), e: (start + c.durationSec - 0.3).toFixed(2) });
      inputs.push("-loop", "1", "-t", String(total.toFixed(2)), "-i", png);
    }
    start += c.durationSec - transition;
  }

  const f: string[] = [];
  clips.forEach((_, i) => f.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=25,format=yuv420p[v${i}]`));

  // crossfade chain
  let prev = "v0";
  let offset = Math.max(0.1, clips[0].durationSec - transition);
  if (clips.length === 1) {
    f.push(`[v0]null[vx]`);
  } else {
    for (let i = 1; i < clips.length; i++) {
      const label = `xf${i}`;
      // dip-to-black between shots — two different rooms are never visible blended together (no overlap)
      f.push(`[${prev}][v${i}]xfade=transition=fadeblack:duration=${transition}:offset=${offset.toFixed(3)}[${label}]`);
      prev = label;
      offset += clips[i].durationSec - transition;
    }
    f.push(`[${prev}]null[vx]`);
  }

  // overlay caption PNGs, each enabled during its window
  let vlabel = "vx";
  caps.forEach((c, k) => {
    const next = k === caps.length - 1 ? "vbase" : `ov${k}`;
    f.push(`[${vlabel}][${c.idx}:v]overlay=0:0:enable='between(t,${c.s},${c.e})'[${next}]`);
    vlabel = next;
  });
  if (vlabel !== "vbase") f.push(`[${vlabel}]null[vbase]`);
  // final cinematic grade (memory movie) or passthrough
  f.push(`[vbase]${grade ? FILM_GRADE : "null"}[vout]`);

  await run([...inputs, "-y", "-filter_complex", f.join(";"), "-map", "[vout]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", out]);
}

/** Lay voiceover over music (music ducked under the voice) onto the silent video. */
async function mixAudio(videoIn: string, out: string, voicePath?: string, musicPath?: string): Promise<void> {
  if (!voicePath && !musicPath) {
    await run(["-y", "-i", videoIn, "-c", "copy", out]);
    return;
  }
  const inputs = ["-i", videoIn];
  let aFilter = "";
  if (voicePath && musicPath) {
    inputs.push("-i", voicePath, "-i", musicPath);
    aFilter = "[2:a]volume=0.18[mus];[1:a]volume=1.0[vo];[vo][mus]amix=inputs=2:duration=first:dropout_transition=2[aout]";
  } else if (voicePath) {
    inputs.push("-i", voicePath);
    aFilter = "[1:a]volume=1.0[aout]";
  } else if (musicPath) {
    inputs.push("-i", musicPath);
    aFilter = "[1:a]volume=0.5[aout]";
  }
  await run([...inputs, "-y", "-filter_complex", aFilter, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
}

/** Branded intro/outro title card → a short fade-in/out clip (premium "produced" feel). */
export async function titleCardClip(opts: { title: string; subtitle?: string; out: string; w: number; h: number; dur: number; workDir: string }): Promise<void> {
  const sharp = (await import("sharp")).default;
  const { title, subtitle = "", w, h, dur } = opts;
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!)).slice(0, 60);
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  const accentY = cy - Math.round(h * 0.11);
  const subY = cy + Math.round(h * 0.08);
  // adaptive title size so long titles never overflow the frame
  const titleFs = Math.min(Math.round(h / 12), Math.floor((w * 0.86) / (Math.max(8, title.length) * 0.56)));
  const subFs = Math.round(h / 30);
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#140a24"/><stop offset="1" stop-color="#2a1144"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect x="${cx - 40}" y="${accentY}" width="80" height="4" rx="2" fill="#ef6d5b"/>
    <text x="${cx}" y="${cy}" font-family="Arial, Helvetica, sans-serif" font-size="${titleFs}" font-weight="800" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${esc(title)}</text>
    ${subtitle ? `<text x="${cx}" y="${subY}" font-family="Arial, Helvetica, sans-serif" font-size="${subFs}" fill="#cbb8e6" text-anchor="middle" dominant-baseline="central">${esc(subtitle)}</text>` : ""}
  </svg>`;
  const png = join(opts.workDir, `card-${Math.random().toString(36).slice(2)}.png`);
  await sharp(Buffer.from(svg)).png().toFile(png);
  await run(["-y", "-loop", "1", "-i", png, "-t", String(dur), "-r", "25",
    "-vf", `fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur - 0.4).toFixed(2)}:d=0.4,format=yuv420p`, "-an", opts.out]);
}

/** Soft cinematic ambient bed (A-major-ish pad, filtered) — a default when no library track is present. */
export async function synthMusicBed(dur: number, out: string): Promise<void> {
  await run([
    "-y",
    "-f", "lavfi", "-i", `sine=frequency=220:duration=${dur}`,
    "-f", "lavfi", "-i", `sine=frequency=277.18:duration=${dur}`,
    "-f", "lavfi", "-i", `sine=frequency=329.63:duration=${dur}`,
    "-filter_complex",
    `[0][1][2]amix=inputs=3,tremolo=f=0.18:d=0.4,lowpass=f=520,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, dur - 2).toFixed(2)}:d=2,volume=0.8[a]`,
    "-map", "[a]", "-c:a", "aac", "-b:a", "160k", out
  ]);
}

/** Build one voice track from per-shot narration clips, each delayed to start at its shot — keeps the
 *  voice in sync with the room on screen. Returns the path, or null if there are no segments. */
export async function buildVoiceTrack(segments: { path: string; startSec: number }[], totalSec: number, out: string): Promise<string | null> {
  if (!segments.length) return null;
  const inputs: string[] = [];
  const parts: string[] = [];
  segments.forEach((s, i) => {
    inputs.push("-i", s.path);
    const ms = Math.max(0, Math.round(s.startSec * 1000));
    parts.push(`[${i}:a]adelay=${ms}|${ms}[a${i}]`);
  });
  const mix = `${segments.map((_, i) => `[a${i}]`).join("")}amix=inputs=${segments.length}:normalize=0:dropout_transition=0[vo]`;
  await run([...inputs, "-y", "-filter_complex", `${parts.join(";")};${mix}`, "-t", totalSec.toFixed(2), "-map", "[vo]", "-c:a", "aac", "-b:a", "192k", out]);
  return out;
}

/** Full compose: clips (+captions, crossfades) + voice over ducked music → final HD mp4. */
export async function composite(opts: {
  clips: { path: string; durationSec: number; caption?: string }[];
  out: string; w: number; h: number; workDir: string; voicePath?: string; musicPath?: string; grade?: boolean;
}): Promise<void> {
  const silent = join(opts.workDir, "visual.mp4");
  await buildVisual(opts.clips, silent, opts.w, opts.h, opts.workDir, 0.6, opts.grade);
  await mixAudio(silent, opts.out, opts.voicePath, opts.musicPath);
}
