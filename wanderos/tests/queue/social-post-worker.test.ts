/**
 * Queue test - social_post worker AI compose path.
 *   Run: npm run test:queue:social-post
 *
 * Proves the Social Feed S5 path:
 * draft post -> durable social_post job -> AI compose crew -> moderation -> pgvector embedding -> Aurora update.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { Worker } = await import("bullmq");
const { queryAurora } = await import("../../lib/db/pool");
const { getJob } = await import("../../lib/db/tables/agent-jobs");
const { createDraftPost } = await import("../../lib/services/post.service");
const { enqueueJob, QUEUE_NAMES, closeQueues } = await import("../../lib/queue/queues");
const { redisConnectionOptions } = await import("../../lib/queue/connection");
const { runJob } = await import("../../lib/queue/runner");
const { JOB_HANDLERS } = await import("../../worker/handlers");
import type { AgentJobRow } from "../../lib/db/tables/agent-jobs";

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── queue: social_post worker AI compose ──\n");

const handler = JOB_HANDLERS.social_post;
if (!handler) throw new Error("social_post handler is not registered");

const worker = new Worker(
  QUEUE_NAMES.social_post,
  async (job) => {
    const agentJobId = job.data.agentJobId as string;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await runJob({ agentJobId, isLastAttempt, handler });
  },
  { connection: redisConnectionOptions(), concurrency: 1, lockDuration: 600000 }
);

async function waitFor(jobId: string, pred: (j: AgentJobRow) => boolean, timeoutMs = 180000): Promise<AgentJobRow | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = await getJob(jobId);
    if (j && pred(j)) return j;
    await new Promise((r) => setTimeout(r, 750));
  }
  return getJob(jobId);
}

let userId = "";
let postId = "";
let jobId = "";
let runId = "";

try {
  await worker.waitUntilReady();
  ok("social_post worker connected");

  const [author] = await queryAurora<{ id: string }>(
    `insert into users (name, email, role) values ('Social Compose Traveler', $1, 'traveler') returning id`,
    [`social-compose-${randomUUID()}@test.local`]
  );
  userId = author.id;

  const draft = await createDraftPost(userId, {
    title: "Kyoto morning market and riverside walk",
    caption: "Kyoto draft.",
    destination: "Kyoto",
    location: "Nishiki Market",
    tags: ["Kyoto", "food", "walks"],
    media: [
      {
        mediaUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        mediaKind: "photo",
        sortOrder: 0,
        aiDescription: "Sample market image used for compose test input."
      }
    ]
  });
  postId = draft.post.id;
  draft.post.status === "draft" ? ok("draft post created") : no(`post status=${draft.post.status}`);

  const job = await enqueueJob({
    type: "social_post",
    userId,
    idempotencyKey: `social-post-worker-${postId}`,
    input: { postId, authorId: userId },
    attempts: 1
  });
  jobId = job.id;
  job.status === "queued" ? ok("social_post job enqueued") : no(`status=${job.status}`);

  const done = await waitFor(job.id, (j) => j.status === "succeeded" || j.status === "failed");
  done?.status === "succeeded" ? ok("social_post worker succeeded") : no(`ended ${done?.status}: ${done?.error ?? ""}`);
  done?.progress === 100 ? ok("progress reached 100") : no(`progress=${done?.progress}`);

  const output = done?.output as { status?: string; runId?: string; embedded?: boolean; moderationStatus?: string };
  runId = output?.runId ?? "";
  output?.status === "compose_ready" ? ok("worker output compose_ready") : no(`output status=${output?.status}`);
  output?.embedded === true ? ok("post embedded into pgvector") : no(`embedded=${output?.embedded}`);
  output?.moderationStatus === "approved" || output?.moderationStatus === "pending_review"
    ? ok(`moderation passed (${output?.moderationStatus})`)
    : no(`moderation=${output?.moderationStatus}`);
  runId ? ok("agent run id returned") : no("run id missing");

  const [post] = await queryAurora<{
    caption: string | null;
    body: string | null;
    status: string;
    moderation_status: string;
    ai_summary: string | null;
    tags: string[];
  }>(`select caption, body, status, moderation_status, ai_summary, tags from travel_posts where id = $1`, [postId]);

  post?.status === "pending_review" ? ok("post moved to pending_review after compose") : no(`post status=${post?.status}`);
  post?.caption && post.caption.length > 40 ? ok("AI caption saved") : no("caption missing");
  post?.body && post.body.length > 80 ? ok("AI body/details saved") : no("body/details missing");
  post?.ai_summary && post.ai_summary.length > 20 ? ok("AI summary saved") : no("AI summary missing");
  Array.isArray(post?.tags) && post.tags.length >= 3 ? ok("AI discovery tags saved") : no(`tags=${post?.tags?.length}`);

  const [embeddingCount] = await queryAurora<{ c: string }>(
    `select count(*) c from embeddings where owner_type = 'post' and owner_id = $1`,
    [postId]
  );
  Number(embeddingCount?.c ?? 0) >= 1 ? ok("pgvector post embedding persisted") : no(`embeddings=${embeddingCount?.c}`);

  if (runId) {
    const [stepCount] = await queryAurora<{ c: string }>(
      `select count(*) c from agent_steps where run_id = $1`,
      [runId]
    );
    Number(stepCount?.c ?? 0) >= 4 ? ok("agent steps traced") : no(`steps=${stepCount?.c}`);
  } else {
    no("agent steps not checked because run id is missing");
  }
} finally {
  await worker.close();
  await closeQueues();
  if (postId) await queryAurora(`delete from embeddings where owner_type = 'post' and owner_id = $1`, [postId]).catch(() => {});
  if (jobId) await queryAurora(`delete from agent_jobs where id = $1`, [jobId]).catch(() => {});
  if (postId) await queryAurora(`delete from travel_posts where id = $1`, [postId]).catch(() => {});
  if (runId) await queryAurora(`delete from agent_runs where id = $1`, [runId]).catch(() => {});
  if (userId) await queryAurora(`delete from users where id = $1`, [userId]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
