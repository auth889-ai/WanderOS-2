import { z } from "zod";

/** mode-director output — the tour plan: order, music, pacing. */
export const PlanSchema = z.object({
  orderedPhotoIndexes: z.array(z.number().int()).describe("shot order: open strong, flow room-to-room, end on a highlight; DROP duplicate rooms"),
  musicMood: z.string().describe("warm · cinematic · upbeat · epic · calm"),
  pacing: z.string().describe("calm | dynamic"),
  styleNote: z.string().describe("one line of directing intent")
});
export type DirectorPlan = z.infer<typeof PlanSchema>;
