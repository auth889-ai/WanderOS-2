"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Film, Loader2, Sparkles } from "lucide-react";
import { AssetUploader, type UploadedAsset } from "@/components/memory/AssetUploader";

/**
 * Autopilot intake: one sentence + the messy pile of trip files. That's the whole ask.
 * Creates the memory job first (so uploads have a B2 prefix), then lets the user
 * upload directly to B2, then hands off to the agent.
 */
export function NewMemoryClient() {
  const router = useRouter();
  const [requestText, setRequestText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createJob() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText: requestText.trim() })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Could not start — check your request text (min 3 characters).");
      }
      const { job } = await res.json();
      setJobId(job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function startAutopilot() {
    if (!jobId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/memory/${jobId}/start`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Could not start the agent");
      }
      router.push(`/memory/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const photoCount = assets.filter((a) => a.kind === "photo").length;
  const canStart = jobId && photoCount >= 3 && !busy;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-teal-600">
          <Film className="h-6 w-6" />
          <span className="text-sm font-semibold uppercase tracking-wide">Memory Autopilot</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900">Don&apos;t let this trip get lost</h1>
        <p className="text-slate-600">
          70% of trip photos are never looked at again. Tell the agent what this trip meant,
          drop in the messy pile, and it will craft a cinematic memory film — with your approval
          at every important step.
        </p>
      </header>

      <section className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          What should this memory feel like?
        </label>
        <textarea
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
          disabled={Boolean(jobId)}
          rows={3}
          placeholder='e.g. "Please make something emotional from our Bali honeymoon — warm and nostalgic, in English"'
          className="w-full rounded-xl border border-slate-300 p-4 text-slate-800 focus:border-teal-400 focus:outline-none disabled:bg-slate-50"
        />
        {!jobId && (
          <button
            onClick={createJob}
            disabled={requestText.trim().length < 3 || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Begin — add your trip files next
          </button>
        )}
      </section>

      {jobId && (
        <section className="space-y-4">
          <AssetUploader jobId={jobId} assets={assets} onChange={setAssets} />
          {photoCount > 0 && photoCount < 3 && (
            <p className="text-sm text-amber-600">Add at least 3 photos so the agent has enough to work with.</p>
          )}
          <button
            onClick={startAutopilot}
            disabled={!canStart}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Film className="h-5 w-5" />}
            Start the Autopilot
          </button>
          <p className="text-xs text-slate-500">
            The agent will understand your trip, plan the story, and pause for your approval before
            anything is generated. Nothing is published without you.
          </p>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
