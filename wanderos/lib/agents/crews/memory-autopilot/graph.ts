import { StateGraph, Annotation, interrupt, MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { invokeStructured } from "@/lib/ai/structured";
import { appendProgress, updateMemoryJob } from "@/lib/db/tables/memory-jobs";
import { isB2Configured, presignDownload } from "@/lib/media/b2";
import {
  AutopilotState,
  GapProposal,
  InferredTripSchema,
  Storyboard,
  StoryboardSchema
} from "./schema";

/**
 * Travel Autopilot brain — LangGraph supervisor with a DURABLE storyboard checkpoint.
 * intake → understand (media-worker timeline) → detect gaps → plan story →
 * interrupt("storyboard") → [resumes on human approval via Command]
 * Generation (P5) attaches after the checkpoint. Postgres checkpointer = pause
 * survives restarts (falls back to MemorySaver when DB is unreachable, e.g. tests).
 */

const MEDIA_WORKER_URL = process.env.MEDIA_WORKER_URL || "http://localhost:8000";

const State = Annotation.Root({
  jobId: Annotation<string>(),
  requestText: Annotation<string>(),
  assetKeys: Annotation<string[]>(),
  inferred: Annotation<AutopilotState["inferred"]>(),
  timeline: Annotation<unknown>(),
  gaps: Annotation<GapProposal[]>(),
  storyboard: Annotation<Storyboard | null>(),
  approval: Annotation<AutopilotState["approval"]>()
});

async function progress(jobId: string, event: string, stage: string, pct: number, extra: object = {}) {
  await appendProgress(jobId, { event, ...extra }, stage, pct);
}

// ── Node 1: intake — parse the one-sentence request into typed trip facts
async function intake(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "understanding" });
  await progress(state.jobId, "agent.intake.started", "understanding", 20);
  const inferred = await invokeStructured(
    InferredTripSchema,
    `A traveler asked for a memory film with this request: "${state.requestText}".
Infer destination, tripType (honeymoon/family/solo/friends/business/trip), the emotional tone
they want, and output language. confidence = how sure you are overall (0-1).`,
    { tier: "flash" }
  );
  await updateMemoryJob(state.jobId, { inferred: inferred as unknown as Record<string, unknown> });
  await progress(state.jobId, "agent.intake.done", "understanding", 25, { inferred });
  return { inferred };
}

// ── Node 2: understand — deterministic EXIF/GPS timeline via the media-worker engine
async function understand(state: typeof State.State) {
  await progress(state.jobId, "agent.understand.started", "understanding", 30);
  const photoKeys = state.assetKeys.filter((k) => !k.endsWith(".pdf"));
  const photos = await Promise.all(
    photoKeys.map(async (key) => ({
      key,
      url: isB2Configured() ? await presignDownload(key) : `unreachable://no-b2/${key}`
    }))
  );
  let timeline: unknown;
  try {
    const res = await fetch(`${MEDIA_WORKER_URL}/analyze/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photos }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!res.ok) throw new Error(`timeline engine ${res.status}`);
    timeline = await res.json();
  } catch (e) {
    // honest degradation: file-order single-day timeline, flagged as such
    timeline = {
      days: [{ day: 1, date: null, moments: [{ photos: photoKeys, start: null, end: null }] }],
      unplaced: [],
      stats: { photos_total: photoKeys.length, photos_dated: 0, days: 1, moments: 1 },
      degraded: `timeline engine unavailable: ${e instanceof Error ? e.message : e}`
    };
  }
  await updateMemoryJob(state.jobId, { timeline });
  await progress(state.jobId, "agent.understand.done", "understanding", 40, {
    stats: (timeline as { stats?: unknown }).stats
  });
  return { timeline };
}

// ── Node 3: gaps — consent-gated missing-memory proposals (rule-based, explainable)
async function detectGaps(state: typeof State.State) {
  await progress(state.jobId, "agent.gaps.started", "planning", 45);
  let gaps: GapProposal[] = [];
  try {
    const res = await fetch(`${MEDIA_WORKER_URL}/analyze/gaps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline: state.timeline, destination: state.inferred?.destination }),
      signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) gaps = (await res.json()).gaps;
  } catch {
    gaps = []; // no engine → no proposals; never invent gaps
  }
  await progress(state.jobId, "agent.gaps.done", "planning", 50, { found: gaps.length });
  return { gaps };
}

// ── Node 4: plan — the story planner (strong tier, zod-gated)
async function planStory(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "planning" });
  await progress(state.jobId, "agent.plan.started", "planning", 55);
  const t = state.timeline as { days?: { day: number; moments: { photos: string[] }[] }[] };
  const timelineBrief = (t.days ?? [])
    .map((d) => `Day ${d.day}: ${d.moments.map((m) => m.photos.join(", ")).join(" | ")}`)
    .join("\n");
  const gapsBrief = state.gaps
    .map((g) => `Day ${g.day} [${g.rule}]: ${g.description} → proposed prompt: ${g.proposal.prompt}`)
    .join("\n");

  const storyboard = await invokeStructured(
    StoryboardSchema,
    `You are the story planner for a cinematic travel memory film.
Trip: ${JSON.stringify(state.inferred)}
Timeline (photo keys per day):
${timelineBrief}
Missing-memory proposals (each REQUIRES viewer consent; include as source="synthetic_scene" with needsConsent=true):
${gapsBrief || "none"}

Plan 4-6 scenes. Rules:
- Prefer real photos: source "original" (best photo shown as-is) or "parallax" (subtle motion on the real photo).
- At most 2 "hero_video" scenes (AI motion on a real photo) for the emotional peaks — set assetKey.
- Synthetic scenes ONLY from the proposals above, needsConsent=true, assetKey=null, genPrompt=the proposed prompt.
- narrationLine per scene, ~12 words, in ${state.inferred?.language ?? "English"}, tone: ${state.inferred?.tone}.
- narrationFull = the full ~60-word narration. Title short and emotional.`,
    { tier: "pro" }
  );

  await updateMemoryJob(state.jobId, {
    storyboard: storyboard as unknown as Record<string, unknown>,
    storyboard_version: 1
  });
  await progress(state.jobId, "agent.plan.done", "planning", 60, { title: storyboard.title });
  return { storyboard };
}

// ── Node 5: the DURABLE human checkpoint — graph pauses here until approval
async function storyboardApproval(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "awaiting_storyboard_approval" });
  await progress(state.jobId, "checkpoint.storyboard", "awaiting_storyboard_approval", 65, {
    scenes: state.storyboard?.scenes.length,
    consentsNeeded: state.storyboard?.scenes.filter((s) => s.needsConsent).length
  });
  const approval = interrupt({
    checkpoint: "storyboard",
    storyboard: state.storyboard,
    gaps: state.gaps
  });
  return { approval };
}

export function buildAutopilotGraph(checkpointer?: PostgresSaver | MemorySaver) {
  const graph = new StateGraph(State)
    .addNode("intake", intake)
    .addNode("understand", understand)
    .addNode("detect_gaps", detectGaps)
    .addNode("plan_story", planStory)
    .addNode("storyboard_approval", storyboardApproval)
    .addEdge("__start__", "intake")
    .addEdge("intake", "understand")
    .addEdge("understand", "detect_gaps")
    .addEdge("detect_gaps", "plan_story")
    .addEdge("plan_story", "storyboard_approval")
    .addEdge("storyboard_approval", "__end__"); // P5 generation attaches here next
  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() });
}

let _saver: PostgresSaver | null = null;
export async function getCheckpointer(): Promise<PostgresSaver | MemorySaver> {
  if (_saver) return _saver;
  const url = process.env.DATABASE_URL;
  if (!url) return new MemorySaver();
  try {
    const saver = PostgresSaver.fromConnString(url);
    await saver.setup(); // creates langgraph checkpoint tables idempotently
    _saver = saver;
    return saver;
  } catch {
    return new MemorySaver(); // degraded but functional (documented)
  }
}
