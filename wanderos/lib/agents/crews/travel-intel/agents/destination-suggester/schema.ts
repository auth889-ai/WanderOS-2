import { z } from "zod";
export const SuggesterResultSchema = z.object({
  trips: z.array(z.object({
    destination: z.string(),     // a real, geocodable place
    why: z.string(),             // one line: why it fits the holiday + budget + interests
    days: z.string().optional()  // suggested trip length e.g. "3 days"
  })).max(5)
});
export type SuggesterResult = z.infer<typeof SuggesterResultSchema>;
