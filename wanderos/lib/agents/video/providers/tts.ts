import { GoogleGenAI } from "@google/genai";
import { writeFile } from "fs/promises";
import { run } from "../../../media/video/ffmpeg";
import type { TTSProvider } from "../types";

/** Gemini TTS — turns the storyboard narration script into a natural voiceover (the host's "tour guide"). */
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer {
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export class GeminiTTSProvider implements TTSProvider {
  id = "gemini-tts";
  constructor(private voice = process.env.GEMINI_TTS_VOICE || "Charon") {}

  async synthesize(script: string, outPath: string): Promise<{ path: string; durationSec: number; costCents: number }> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error("no Gemini API key for TTS");
    const ai = new GoogleGenAI({ apiKey });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await ai.models.generateContent({
      model: process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Read this warmly, like a premium property tour narrator:\n${script}` }] }],
      config: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } } }
    } as never);
    const data = res.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("Gemini TTS returned no audio");
    const pcm = Buffer.from(data, "base64");

    const wav = outPath.replace(/\.[^.]+$/, ".wav");
    await writeFile(wav, pcmToWav(pcm));
    await run(["-y", "-i", wav, "-c:a", "aac", "-b:a", "192k", outPath]); // → aac for the compositor
    const durationSec = pcm.length / (24000 * 2); // 24kHz, 16-bit mono
    return { path: outPath, durationSec, costCents: 5 };
  }
}
