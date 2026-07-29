"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { AssetUploader, type UploadedAsset } from "@/components/memory/AssetUploader";

/**
 * Autopilot intake: one sentence + the messy pile of trip files.
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
    <div className="-m-6 min-h-screen bg-canvas p-6 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl py-10">
        <header className="mb-9 text-center">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slateInk">
            Travel Autopilot
          </p>
          <h1 className="font-display text-[2.5rem] leading-[1.12] text-ink">
            Every journey
            <br />
            has a feeling.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-slateInk">
            Drop in the messy pile — photos, your itinerary, a voice note. The agent
            reconstructs what happened, and asks before recreating anything it can&apos;t prove.
          </p>
        </header>

        <section className="rounded-2xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(26,29,25,0.04)]">
          <label className="mb-2 block text-sm font-medium text-ink">
            What should this memory feel like?
          </label>
          <textarea
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            disabled={Boolean(jobId)}
            rows={3}
            placeholder="Make something emotional from our Bali honeymoon — warm and nostalgic"
            className="w-full resize-none rounded-xl border border-line bg-canvas/60 p-4 text-[15px] text-ink outline-none transition placeholder:text-slateInk/50 focus:border-forest/40 focus:bg-card disabled:opacity-60"
          />
          {!jobId && (
            <button
              onClick={createJob}
              disabled={requestText.trim().length < 3 || busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-forestDeep disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          )}
        </section>

        {jobId && (
          <section className="mt-5 space-y-4 rounded-2xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(26,29,25,0.04)]">
            <AssetUploader jobId={jobId} assets={assets} onChange={setAssets} />
            {photoCount > 0 && photoCount < 3 && (
              <p className="text-sm text-forest">
                Add at least 3 photos so the agent has enough to work with.
              </p>
            )}
            <button
              onClick={startAutopilot}
              disabled={!canStart}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-6 py-3.5 text-[15px] font-semibold text-white transition hover:bg-forestDeep disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Start the Autopilot
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
            <p className="text-center text-xs leading-relaxed text-slateInk">
              Nothing is generated or published without your approval.
            </p>
          </section>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-coral/30 bg-coral/5 p-3 text-sm text-coral">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
