import { z } from "zod";

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Meters. Optional — not every device/browser reports GPS accuracy.
  accuracy: z.number().nonnegative().optional(),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const setSharingSchema = z.object({
  enabled: z.boolean(),
});

export type SetSharingInput = z.infer<typeof setSharingSchema>;
