"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useStudioJob } from "@/lib/hooks/useStudioJob";
import { BriefForm } from "@/components/host-studio/BriefForm";
import { CrewProgress } from "@/components/host-studio/CrewProgress";
import { DraftReview } from "@/components/host-studio/DraftReview";

const fade = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 } };

/** Thin orchestrator: wires the useStudioJob hook to the presentational steps. No fetch, no logic. */
export function StudioClient() {
  const { phase, progress, stage, error, listing, start, saveEdit, publish, retry } = useStudioJob();

  return (
    <div>
      <AnimatePresence mode="wait">
        {phase === "brief" && (
          <motion.div key="brief" {...fade}>
            <BriefForm onGenerate={start} />
          </motion.div>
        )}
        {phase === "generating" && (
          <motion.div key="gen" {...fade}>
            <CrewProgress progress={progress} stage={stage} error={error} onRetry={retry} />
          </motion.div>
        )}
        {phase === "review" && listing && (
          <motion.div key="rev" {...fade}>
            <DraftReview listing={listing} error={error} onSave={saveEdit} onPublish={publish} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
