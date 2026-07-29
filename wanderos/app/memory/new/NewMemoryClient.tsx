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
    <div className="mx-auto max-w-2xl py-8">
      {/* Photographic hero, as in the reference splash — the imagery IS the
          product, so it stays visible instead of being covered by a flat panel. */}
      <header className="relative mb-6 overflow-hidden rounded-3xl">
        <img
          src="/images/bg/mountain.webp"
          alt=""
          className="h-64 w-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,26,18,0.15),rgba(20,26,18,0.82))]" />
        <div className="absolute inset-x-0 bottom-0 p-7">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
            Travel Autopilot
          </p>
          <h1 className="font-display text-[2.4rem] leading-[1.08] text-white">
            Every journey
            <br />
            has a feeling.
          </h1>
        </div>
      </header>

      <p className="mb-6 px-1 text-[15px] leading-relaxed text-white/70">
        Drop in the messy pile — photos, your itinerary, a voice note. The agent
        reconstructs what happened, and asks before recreating anything it can&apos;t prove.
      </p>

      <section className="rounded-2xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-xl">
          <label className="mb-2 block text-sm font-medium text-white">
            What should this memory feel like?
          </label>
          <textarea
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            disabled={Boolean(jobId)}
            rows={3}
            placeholder="Make something emotional from our Bali honeymoon — warm and nostalgic"
            className="w-full resize-none rounded-xl border border-white/15 bg-black/25 p-4 text-[15px] text-white outline-none transition placeholder:text-white/35 focus:border-white/40 disabled:opacity-60"
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
          <section className="mt-5 space-y-4 rounded-2xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-xl">
            <AssetUploader jobId={jobId} assets={assets} onChange={setAssets} />
            {photoCount > 0 && photoCount < 3 && (
              <p className="text-sm text-peach">
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
            <p className="text-center text-xs leading-relaxed text-white/50">
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
  );
}
