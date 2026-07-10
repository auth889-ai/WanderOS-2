import { invokeStructured } from "@/lib/ai/structured";
import { PlanSchema, type DirectorPlan } from "./schema";
import { buildModeDirectorPrompt } from "./prompt";
import type { Perceived } from "../shot-vision/schema";
import type { VideoMode } from "../../types";

/** Agent 2 · mode-director — orders shots, picks music/pacing, drops duplicate rooms. */
export async function runModeDirector(input: { perceived: Perceived; mode: VideoMode }): Promise<DirectorPlan> {
  return invokeStructured(PlanSchema, buildModeDirectorPrompt(input.perceived, input.mode), { tier: "flash" });
}
