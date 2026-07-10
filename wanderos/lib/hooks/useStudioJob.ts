"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api/host-listings";

/** The crew's stages, in order — mirrors the worker's studioHandler labels. Drives the live pipeline UI. */
export const STUDIO_STAGES = [
  "Analyzing your photos",
  "Building the property profile",
  "Extracting facts & amenities",
  "Researching comparable prices",
  "Writing the listing copy",
  "Safety & policy review",
  "Composing room-by-room detail",
  "Tagging & indexing for search",
  "Quality check",
  "Finalizing your draft"
];

export type StudioPhase = "brief" | "generating" | "review";

/**
 * Owns the entire Host-Studio client flow: start the job → stream live progress (SSE) → review the
 * draft → edit/publish. All network calls go through the typed api client; all state lives here, so
 * the components stay presentational. This is the FE counterpart to listing.service.
 */
export function useStudioJob() {
  const [phase, setPhase] = useState<StudioPhase>("brief");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [listing, setListing] = useState<api.ListingRow | null>(null);
  const idRef = useRef("");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const stream = useCallback((id: string) => {
    esRef.current?.close();
    const es = new EventSource(api.jobStreamUrl(id));
    esRef.current = es;
    es.onmessage = async (ev) => {
      const data = JSON.parse(ev.data) as { jobs?: api.JobView[]; done?: boolean };
      const studio = data.jobs?.find((j) => j.type === "studio");
      if (studio) {
        setProgress(studio.progress || 0);
        if (studio.stage) setStage(studio.stage);
        if (studio.status === "succeeded") {
          es.close();
          setListing(await api.getListing(id));
          setPhase("review");
        } else if (studio.status === "failed") {
          es.close();
          setError(studio.error ?? "The crew hit an error.");
        }
      }
      if (data.done) es.close();
    };
    es.onerror = () => es.close();
  }, []);

  const start = useCallback(
    async (body: api.StartDraftBody) => {
      setError("");
      setPhase("generating");
      setProgress(2);
      setStage("Starting the crew…");
      try {
        const { listingId } = await api.startDraft({ ...body, submitId: crypto.randomUUID() });
        idRef.current = listingId;
        stream(listingId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start");
        setPhase("brief");
      }
    },
    [stream]
  );

  const saveEdit = useCallback(async (patch: Record<string, unknown>) => {
    if (!idRef.current) return;
    try {
      setListing(await api.editListing(idRef.current, patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }, []);

  const publish = useCallback(async () => {
    if (!idRef.current) return;
    try {
      setListing(await api.publishListing(idRef.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    }
  }, []);

  const retry = useCallback(async () => {
    if (!idRef.current) return;
    setError("");
    setPhase("generating");
    setProgress(2);
    setStage("Retrying…");
    try {
      await api.retryJob(idRef.current);
      stream(idRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
      setPhase("review");
    }
  }, [stream]);

  return { phase, progress, stage, error, listing, start, saveEdit, publish, retry };
}
