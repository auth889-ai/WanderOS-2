import { z } from "zod";
export const TravelIntelInputSchema = z.object({
  query: z.string().min(1),
  budget: z.string().optional(),
  interests: z.array(z.string()).optional(),
  country: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  userId: z.string().optional()
});
export type TravelIntelInput = z.infer<typeof TravelIntelInputSchema>;
