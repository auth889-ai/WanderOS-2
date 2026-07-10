import { invokeStructured } from "@/lib/ai/structured";
import { buildMovieDirectorPrompt } from "./prompt";
import { MovieDirectorResult, MovieDirectorResultSchema } from "./schema";
export async function directMovie(ctx: Parameters<typeof buildMovieDirectorPrompt>[0]): Promise<MovieDirectorResult> {
  return MovieDirectorResultSchema.parse(await invokeStructured(MovieDirectorResultSchema, buildMovieDirectorPrompt(ctx), { tier: "reasoning" }));
}
