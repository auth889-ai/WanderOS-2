import { JobHandler } from "@/lib/queue/runner";
import { JobType } from "@/lib/db/tables/agent-jobs";
import { studioHandler } from "./handlers/studio";
import { socialPostHandler } from "./handlers/socialPost";
import { tripPlanHandler } from "./handlers/tripPlan";
import { videoHandler } from "./handlers/video";
import { memoryBuildHandler } from "./handlers/memoryBuild";
import { jarMovieHandler } from "./handlers/jarMovie";
import { memoryAutopilotHandler } from "./handlers/memoryAutopilot";

/**
 * Maps each job type → its crew handler. Each handler is a thin adapter that runs a crew and reports
 * progress via the JobContext.
 *   - `studio`        → ✅ Host Studio crew (10 nodes)
 *   - `listing_video` → ✅ Listing Video crew (shot-vision → director → narration → captions → render)
 *   - `trip_plan`     → ✅ Trip Planner crew
 *   - `social_post`   → ✅ Social Feed compose crew
 *   - `memory_build`  → ✅ Memory Book design crew (curate → narrate → layout → compose → decorate)
 */
export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  studio: studioHandler,
  listing_video: videoHandler,
  trip_plan: tripPlanHandler,
  social_post: socialPostHandler,
  memory_build: memoryBuildHandler,
  jar_movie: jarMovieHandler,
  memory_autopilot: memoryAutopilotHandler
};
