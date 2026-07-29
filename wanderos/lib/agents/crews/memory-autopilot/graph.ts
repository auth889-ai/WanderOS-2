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
  approval: Annotation<AutopilotState["approval"]>(),
  renderJob: Annotation<Record<string, unknown> | null>(),
  finalApproval: Annotation<{ decision: string } | null>(),
  evidence: Annotation<Record<string, unknown> | null>(),
  claims: Annotation<Claim[]>(),
  consentDecisions: Annotation<Record<string, string>>()
});

/** A statement the film might make, with how well the evidence supports it. */
type Claim = {
  id: string;
  text: string;
  status: "VERIFIED" | "INFERRED" | "USER_CONFIRMED" | "SYNTHETIC" | "CONTRADICTED" | "UNKNOWN";
  confidence: number;
  evidence: string[];
  question: string;
  day?: number | null;
};

const DOC_EXT = [".pdf", ".doc", ".docx", ".txt"];
const VOICE_EXT = [".mp3", ".m4a", ".wav", ".aac", ".ogg"];

function assetKind(key: string): "document" | "voice" | "photo" {
  const lower = key.toLowerCase();
  if (DOC_EXT.some((e) => lower.endsWith(e))) return "document";
  if (VOICE_EXT.some((e) => lower.endsWith(e))) return "voice";
  return "photo";
}

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

// ── Node 1.5: evidence — read ALL three source types, then classify every claim
// by how well the evidence actually supports it. This is the gate that stops the
// system inventing a memory: nothing may be recreated from an INFERRED claim.
async function extractEvidence(state: typeof State.State) {
  await progress(state.jobId, "agent.evidence.started", "understanding", 26);
  const assets = await Promise.all(
    state.assetKeys.map(async (key) => ({
      key,
      kind: assetKind(key),
      url: isB2Configured() ? await presignDownload(key) : `unreachable://no-b2/${key}`
    }))
  );

  try {
    const res = await fetch(`${MEDIA_WORKER_URL}/evidence/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: state.jobId, assets, timeline: state.timeline ?? null }),
      signal: AbortSignal.timeout(300_000)
    });
    if (!res.ok) throw new Error(`evidence engine ${res.status}`);
    const data = await res.json();
    const claims: Claim[] = data.claims ?? [];
    await updateMemoryJob(state.jobId, {
      evidence: data.evidence as Record<string, unknown>,
      claims: claims as unknown as Record<string, unknown>
    });
    await progress(state.jobId, "agent.evidence.done", "understanding", 32, {
      sources: data.evidence?.sources_used ?? [],
      classifier: data.classifier,
      verified: claims.filter((c) => c.status === "VERIFIED").length,
      uncertain: claims.filter((c) => c.status === "INFERRED" || c.status === "CONTRADICTED").length
    });
    return { evidence: data.evidence, claims };
  } catch (e) {
    // Never fabricate evidence on failure — proceed with none, and say so.
    await progress(state.jobId, "agent.evidence.degraded", "understanding", 32, {
      error: e instanceof Error ? e.message : String(e)
    });
    return { evidence: null, claims: [] as Claim[] };
  }
}

// ── Node 2.5: the CONSENT checkpoint — durable pause on the truth boundary.
// Only the traveler can turn "the itinerary planned it" into "it happened".
async function consentCheckpoint(state: typeof State.State) {
  const pending = (state.claims ?? []).filter(
    (c) => (c.status === "INFERRED" || c.status === "CONTRADICTED") && c.question
  );
  if (pending.length === 0) return { consentDecisions: {} };

  await updateMemoryJob(state.jobId, { status: "awaiting_consent" });
  await progress(state.jobId, "checkpoint.consent", "awaiting_consent", 38, {
    questions: pending.length
  });
  const decisions = interrupt({
    checkpoint: "consent",
    questions: pending.map((c) => ({
      id: c.id,
      text: c.text,
      question: c.question,
      status: c.status,
      evidence: c.evidence
    }))
  }) as Record<string, string>;

  // Fold answers in via the engine so promotion to USER_CONFIRMED happens in
  // exactly one place (media-worker truth.apply_consent), never client-side.
  try {
    const res = await fetch(`${MEDIA_WORKER_URL}/evidence/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claims: state.claims, decisions }),
      signal: AbortSignal.timeout(30_000)
    });
    if (res.ok) {
      const data = await res.json();
      await progress(state.jobId, "agent.consent.applied", "planning", 42, {
        generatable: data.generatable?.length ?? 0
      });
      return { claims: data.claims as Claim[], consentDecisions: decisions };
    }
  } catch {
    /* fall through — keep the unpromoted claims rather than guessing */
  }
  return { consentDecisions: decisions };
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

  // The truth boundary, handed to the planner as hard constraints.
  const claims = state.claims ?? [];
  const verified = claims.filter((c) => c.status === "VERIFIED");
  const confirmed = claims.filter((c) => c.status === "USER_CONFIRMED");
  const forbidden = claims.filter(
    (c) => c.status === "INFERRED" || c.status === "CONTRADICTED" || c.status === "UNKNOWN"
  );
  const truthBrief = claims.length
    ? `
EVIDENCE-BACKED MOMENTS (show these with the real media, no disclosure needed):
${verified.map((c) => `- ${c.text}`).join("\n") || "none"}

TRAVELER-CONFIRMED MOMENTS (no photo exists, but the traveler confirmed it happened —
you MAY recreate these as source="synthetic_scene", needsConsent=true):
${confirmed.map((c) => `- ${c.text}`).join("\n") || "none"}

FORBIDDEN — the traveler did NOT confirm these. You must NOT depict them, mention them
in narration, or imply they happened:
${forbidden.map((c) => `- ${c.text}`).join("\n") || "none"}
`
    : "";

  const storyboard = await invokeStructured(
    StoryboardSchema,
    `You are the story planner for a cinematic travel memory film.
Trip: ${JSON.stringify(state.inferred)}
${truthBrief}
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

// ── Node 6: generation — hand the approved storyboard to the media-worker
// render engine (per-scene AgentLoop + Claude critic + compose + seal) and
// poll its durable job state until delivered/failed.
async function generateFilm(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "generating" });
  await progress(state.jobId, "agent.generate.started", "generating", 70);
  const consents = state.approval?.consents ?? {};
  const res = await fetch(`${MEDIA_WORKER_URL}/jobs/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: state.jobId,
      trip_id: state.jobId,
      storyboard: state.storyboard,
      consents
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Error(`render engine ${res.status}`);

  // Poll the durable job (survives worker restarts — state mirrored to B2).
  let job: Record<string, unknown> = await res.json();
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const poll = await fetch(`${MEDIA_WORKER_URL}/jobs/${state.jobId}`, {
      signal: AbortSignal.timeout(15_000)
    });
    if (poll.ok) {
      job = await poll.json();
      if (job.status === "delivered" || job.status === "failed") break;
      await progress(state.jobId, "agent.generate.progress", "generating", 80, {
        engineStatus: job.status
      });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (job.status !== "delivered") {
    throw new Error(`render job ended: ${job.status} ${job.error ?? ""}`);
  }
  await progress(state.jobId, "agent.generate.done", "generating", 88, {
    stored: job.stored,
    verified: (job.verification as { verified?: boolean } | undefined)?.verified
  });
  return { renderJob: job };
}

// ── Node 7: final approval — the second DURABLE human checkpoint
async function finalApproval(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "awaiting_final_approval" });
  await progress(state.jobId, "checkpoint.final", "awaiting_final_approval", 92, {
    film: state.renderJob?.delivery_key ?? state.renderJob?.film
  });
  const approval = interrupt({ checkpoint: "final", renderJob: state.renderJob });
  return { finalApproval: approval };
}

// ── Node 8: deliver — mark the job done; the sealed film + passport already
// live in B2 (delivery/ + provenance manifests with Object Lock).
async function deliver(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "delivered" });
  await progress(state.jobId, "agent.deliver.done", "delivered", 100, {
    delivery: state.renderJob?.delivery_key,
    stored: state.renderJob?.stored
  });
  return {};
}

// ── Node: cancelled — the traveller said no. Terminal, and nothing generated.
async function cancelled(state: typeof State.State) {
  await updateMemoryJob(state.jobId, { status: "failed", error: "cancelled by traveller" });
  await progress(state.jobId, "job.cancelled", "failed", 100);
  return {};
}

/** Where a storyboard decision leads. Rejection must never reach generation. */
function afterStoryboard(state: typeof State.State): "generate_film" | "plan_story" | "cancelled" {
  const decision = state.approval?.decision;
  if (decision === "rejected") return "cancelled";
  // "revision_requested" sends the planner back around with the notes, rather
  // than making the traveller start the whole trip again.
  if (decision === "revision_requested") return "plan_story";
  return "generate_film"; // approved | edited
}

/** Where a final decision leads. Only an explicit approval delivers. */
function afterFinal(state: typeof State.State): "deliver" | "generate_film" | "cancelled" {
  const decision = state.finalApproval?.decision;
  if (decision === "rejected") return "cancelled";
  if (decision === "revision_requested") return "generate_film";
  return "deliver";
}

export function buildAutopilotGraph(checkpointer?: PostgresSaver | MemorySaver) {
  const graph = new StateGraph(State)
    .addNode("intake", intake)
    .addNode("understand", understand)
    .addNode("extract_evidence", extractEvidence)
    .addNode("consent_checkpoint", consentCheckpoint)
    .addNode("detect_gaps", detectGaps)
    .addNode("plan_story", planStory)
    .addNode("storyboard_approval", storyboardApproval)
    .addNode("generate_film", generateFilm)
    .addNode("final_approval", finalApproval)
    .addNode("deliver", deliver)
    .addNode("cancelled", cancelled)
    .addEdge("__start__", "intake")
    .addEdge("intake", "understand")
    // Evidence runs AFTER the timeline so claim classification can weigh
    // EXIF/GPS structure alongside the document, voice and photo content.
    .addEdge("understand", "extract_evidence")
    .addEdge("extract_evidence", "consent_checkpoint")
    .addEdge("consent_checkpoint", "detect_gaps")
    .addEdge("detect_gaps", "plan_story")
    .addEdge("plan_story", "storyboard_approval")
    // The human decisions MUST route. With unconditional edges a rejected
    // storyboard still ran generation — which would have burned provider spend
    // on work the traveller explicitly refused, and broken the core promise
    // that nothing is generated without approval.
    .addConditionalEdges("storyboard_approval", afterStoryboard, {
      generate_film: "generate_film",
      plan_story: "plan_story",
      cancelled: "cancelled"
    })
    .addEdge("generate_film", "final_approval")
    .addConditionalEdges("final_approval", afterFinal, {
      deliver: "deliver",
      generate_film: "generate_film",
      cancelled: "cancelled"
    })
    .addEdge("deliver", "__end__")
    .addEdge("cancelled", "__end__");
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
