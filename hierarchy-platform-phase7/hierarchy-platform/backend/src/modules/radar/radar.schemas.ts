import { z } from "zod";

// Query param, so it always arrives as a string (or undefined) —
// validated/defaulted here rather than in the controller, same
// convention every other module's *.schemas.ts follows.
export const radarQuerySchema = z.object({
  filter: z.enum(["LEADERS", "PEERS", "ALL"]).default("ALL"),
});

export type RadarQuery = z.infer<typeof radarQuerySchema>;
