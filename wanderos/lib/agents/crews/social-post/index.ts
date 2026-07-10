import { addStep, createRun, finishRun } from "@/lib/db/tables/agent-runs";
import { remember } from "@/lib/agents/tools/pgvector-retriever.tool";
import { analyzePostShots } from "./agents/shot-vision/agent";
import { writeSocialCaption } from "./agents/caption-writer/agent";
import { tagSocialPost } from "./agents/tagger/agent";
import { moderateSocialPost } from "./agents/moderation/agent";
import { SocialPostCrewInput, SocialPostCrewInputSchema, SocialPostCrewResultSchema } from "./schemas";

export type SocialPostStep = {
  name: string;
  sequence: number;
};

function summarize(value: unknown, max = 320): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function recordStep(params: {
  runId: string;
  sequence: number;
  name: string;
  tool: string;
  status: "completed" | "failed";
  input?: unknown;
  output?: unknown;
}) {
  await addStep({
    runId: params.runId,
    agentName: params.name,
    status: params.status,
    sequence: params.sequence,
    toolUsed: params.tool,
    inputSummary: params.input ? summarize(params.input) : undefined,
    outputSummary: params.output ? summarize(params.output) : undefined
  }).catch((error) => {
    console.warn(`[social-post trace] addStep failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function cleanTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function embeddingText(input: SocialPostCrewInput, result: { caption: string; body: string; tags: string[]; mood: string }) {
  return [
    input.title,
    result.caption,
    result.body,
    `destination: ${input.destination || ""}`,
    `location: ${input.location || ""}`,
    `mood: ${result.mood}`,
    `tags: ${result.tags.join(", ")}`
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runSocialPostCrew(
  rawInput: unknown,
  onStep?: (step: SocialPostStep) => Promise<void> | void
) {
  const input = SocialPostCrewInputSchema.parse(rawInput);
  const run = await createRun({
    userId: input.authorId,
    workflow: "social_post",
    input: {
      postId: input.postId,
      authorId: input.authorId,
      title: input.title,
      destination: input.destination,
      mediaCount: input.media.length,
      verifiedStay: input.verifiedStay
    }
  });

  let sequence = 0;
  const step = async <T>(name: string, tool: string, fn: () => Promise<T>, stepInput?: unknown): Promise<T> => {
    const seq = ++sequence;
    try {
      const output = await fn();
      await recordStep({ runId: run.id, sequence: seq, name, tool, status: "completed", input: stepInput, output });
      if (onStep) await onStep({ name, sequence: seq });
      return output;
    } catch (error) {
      await recordStep({
        runId: run.id,
        sequence: seq,
        name,
        tool,
        status: "failed",
        input: stepInput,
        output: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

  try {
    const shotVision = await step(
      "shot-vision",
      "vision-model",
      () =>
        analyzePostShots({
          title: input.title,
          destination: input.destination,
          location: input.location,
          media: input.media
        }),
      { mediaCount: input.media.length }
    );

    const caption = await step(
      "caption-writer",
      "llm-pro",
      () =>
        writeSocialCaption({
          title: input.title,
          existingCaption: input.caption,
          existingBody: input.body,
          destination: input.destination,
          location: input.location,
          verifiedStay: input.verifiedStay,
          listingId: input.listingId,
          bookingId: input.bookingId,
          visualSummary: shotVision.visualSummary,
          vibe: shotVision.vibe,
          placeClues: shotVision.placeClues,
          honestyNotes: shotVision.honestyNotes
        }),
      { title: input.title, verifiedStay: input.verifiedStay }
    );

    const tags = await step(
      "tagger",
      "llm-flash",
      () =>
        tagSocialPost({
          caption: caption.caption,
          body: caption.body,
          destination: input.destination,
          location: input.location,
          existingTags: input.tags,
          visualSummary: shotVision.visualSummary,
          highlights: caption.highlights
        }),
      { existingTags: input.tags }
    );

    const mergedTags = cleanTags([...input.tags, ...tags.tags, ...(tags.destination ? [tags.destination] : [])]);

    const moderation = await step(
      "moderation",
      "llm-policy",
      () =>
        moderateSocialPost({
          title: input.title,
          caption: caption.caption,
          body: caption.body,
          tags: mergedTags,
          verifiedStay: input.verifiedStay,
          hasBookingId: Boolean(input.bookingId),
          hasListingId: Boolean(input.listingId),
          visualSummary: shotVision.visualSummary,
          honestyNotes: shotVision.honestyNotes
        }),
      { verifiedStay: input.verifiedStay, tagCount: mergedTags.length }
    );

    let embedded = false;
    if (moderation.status === "approved" || moderation.status === "pending_review") {
      await step(
        "embedder",
        "pgvector",
        async () => {
          await remember({
            ownerType: "post",
            ownerId: input.postId,
            content: embeddingText(input, {
              caption: caption.caption,
              body: caption.body,
              tags: mergedTags,
              mood: tags.mood
            }),
            metadata: {
              userId: input.authorId,
              postId: input.postId,
              destination: tags.destination ?? input.destination,
              location: tags.locationLabel ?? input.location,
              verifiedStay: input.verifiedStay,
              listingId: input.listingId ?? null,
              bookingId: input.bookingId ?? null
            }
          });
          embedded = true;
          return { embedded: true, ownerType: "post", ownerId: input.postId };
        },
        { ownerType: "post", ownerId: input.postId }
      );
    }

    const result = SocialPostCrewResultSchema.parse({
      caption: caption.caption,
      body: caption.body,
      mood: tags.mood,
      tags: mergedTags,
      destination: tags.destination ?? input.destination ?? null,
      aiSummary: caption.aiSummary,
      moderationStatus: moderation.status,
      moderationReport: {
        reasons: moderation.reasons,
        privacyFlags: moderation.privacyFlags,
        honestyNotes: [...shotVision.honestyNotes, ...moderation.honestyNotes],
        requiredEdits: moderation.requiredEdits,
        highlights: caption.highlights,
        visualSummary: shotVision.visualSummary,
        bestShots: shotVision.bestShots
      },
      embedded
    });

    await finishRun(run.id, result, "completed");
    return { runId: run.id, result };
  } catch (error) {
    await finishRun(run.id, { error: error instanceof Error ? error.message : String(error) }, "failed").catch(() => {});
    throw error;
  }
}
