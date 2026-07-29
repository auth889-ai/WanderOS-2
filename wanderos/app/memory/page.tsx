import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listMemoryJobsForOwner } from "@/lib/db/tables/memory-jobs";

export const dynamic = "force-dynamic";

const STAGE: Record<string, { label: string; tone: string }> = {
  intake: { label: "Collecting files", tone: "bg-white/10 text-white/70" },
  collecting: { label: "Collecting files", tone: "bg-white/10 text-white/70" },
  understanding: { label: "Reading your evidence", tone: "bg-[#8FBF7F]/20 text-[#B9DCA8]" },
  awaiting_consent: { label: "Needs your answers", tone: "bg-[#E8B87A]/25 text-[#F0C9A0]" },
  planning: { label: "Planning the story", tone: "bg-[#8FBF7F]/20 text-[#B9DCA8]" },
  awaiting_storyboard_approval: { label: "Needs your approval", tone: "bg-[#E8B87A]/25 text-[#F0C9A0]" },
  generating: { label: "Generating scenes", tone: "bg-[#8FBF7F]/20 text-[#B9DCA8]" },
  critiquing: { label: "Reviewing quality", tone: "bg-[#8FBF7F]/20 text-[#B9DCA8]" },
  awaiting_final_approval: { label: "Ready for your review", tone: "bg-[#E8B87A]/25 text-[#F0C9A0]" },
  delivering: { label: "Delivering", tone: "bg-[#8FBF7F]/20 text-[#B9DCA8]" },
  delivered: { label: "Delivered", tone: "bg-[#8FBF7F]/25 text-[#B9DCA8]" },
  failed: { label: "Needs attention", tone: "bg-[#FFB08F]/20 text-[#FFB08F]" }
};

export default async function MemoryIndexPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/memory");
  const jobs = await listMemoryJobsForOwner(session.id).catch(() => []);

  const needsYou = jobs.filter((j) =>
    ["awaiting_consent", "awaiting_storyboard_approval", "awaiting_final_approval"].includes(j.status)
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Travel Autopilot
          </p>
          <h1 className="font-display text-[2.2rem] leading-tight text-white">Your memory films</h1>
          <p className="mt-1 text-sm text-white/60">
            {jobs.length === 0
              ? "No trips yet — start with the messy pile of files."
              : `${jobs.length} trip${jobs.length === 1 ? "" : "s"}${needsYou.length ? ` · ${needsYou.length} waiting on you` : ""}`}
          </p>
        </div>
        <Link
          href="/memory/new"
          className="rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white transition hover:bg-forestDeep"
        >
          New memory film
        </Link>
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-white/12 bg-white/[0.06] p-10 text-center backdrop-blur-xl">
          <h2 className="font-display text-xl text-white">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/60">
            Drop in photos, your booking PDF and a voice note. The agent reads all three,
            reconstructs the trip, and asks before recreating anything it can&apos;t prove.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => {
            const stage = STAGE[job.status] ?? { label: job.status, tone: "bg-white/10 text-white/70" };
            const title =
              (job.storyboard as { title?: string } | null)?.title || job.request_text.slice(0, 70);
            const waiting = needsYou.some((j) => j.id === job.id);
            return (
              <li key={job.id}>
                <Link
                  href={`/memory/${job.id}`}
                  className={`block rounded-2xl border p-5 backdrop-blur-xl transition ${
                    waiting
                      ? "border-[#E8B87A]/45 bg-[#E8B87A]/[0.10] hover:border-[#E8B87A]/70"
                      : "border-white/12 bg-white/[0.06] hover:border-white/25"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${stage.tone}`}>
                      {stage.label}
                    </span>
                    <span className="text-[11px] text-white/40">
                      {new Date(job.created_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })}
                    </span>
                    <span className="ml-auto text-[11px] text-white/40">
                      {job.asset_keys.length} file{job.asset_keys.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-[1.2rem] text-white">{title}</h3>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${waiting ? "bg-[#E8B87A]" : "bg-[#8FBF7F]"}`}
                      style={{ width: `${Math.max(4, job.progress_pct)}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
