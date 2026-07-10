import { z } from "zod";
export const HolidayConciergeResultSchema = z.object({
  overview: z.string(),                                    // what this holiday is + the travel opportunity
  whatToDo: z.array(z.string()).max(6),                   // specific things a traveler can DO during it
  traditions: z.array(z.string()).max(4),                 // cultural traditions / foods
  bestDestinations: z.array(z.object({ name: z.string(), why: z.string() })).max(6),
  travelTip: z.string()
});
export type HolidayConciergeResult = z.infer<typeof HolidayConciergeResultSchema>;
