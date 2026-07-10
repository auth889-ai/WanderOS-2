"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { tripStreamUrl } from "@/lib/api/trips";

type StreamJob = {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage: string | null;
  error?: string | null;
  output?: Record<string, unknown>;
};

export function PlanProgress({ tripId, compact = false }: { tripId: string; compact?: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<StreamJob[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const source = new EventSource(tripStreamUrl(tripId));
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { jobs?: StreamJob[]; done?: boolean; error?: string };
      if (payload.jobs) setJobs(payload.jobs);
      if (payload.error) setError(payload.error);
      if (payload.done) {
        source.close();
        setTimeout(() => router.refresh(), 600);
      }
    };
    source.onerror = () => {
      setError("Live progress is unavailable.");
      source.close();
    };
    return () => source.close();
  }, [router, tripId]);

  const active = useMemo(() => jobs[0], [jobs]);
  const progress = active?.progress ?? 0;
  const status = active?.status ?? "queued";
  const terminal = ["succeeded", "failed", "cancelled"].includes(status);

  return (
    <section className={`rounded-[8px] border border-white/12 bg-black/34 p-4 backdrop-blur-xl ${compact ? "" : "shadow-2xl shadow-black/20"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-aurora">Planning job</p>
          <p className="mt-1 text-sm text-white/70">{active?.stage || "Waiting for planner worker"}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-white/12 bg-white/8">
          {status === "succeeded" ? <CheckCircle2 className="h-5 w-5 text-aurora" /> : status === "failed" ? <XCircle className="h-5 w-5 text-coral" /> : <Loader2 className="h-5 w-5 animate-spin text-white" />}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-aurora transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-white/52">
        <span className="capitalize">{status}</span>
        <span>{progress}%</span>
      </div>
      {error || active?.error ? <p className="mt-3 text-sm text-coral">{error || active?.error}</p> : null}
      {!terminal && !error ? <p className="mt-3 text-xs text-white/48">Worker must be running for this progress to advance.</p> : null}
    </section>
  );
}
