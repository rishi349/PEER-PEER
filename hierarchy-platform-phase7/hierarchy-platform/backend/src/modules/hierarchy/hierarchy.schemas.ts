import { z } from "zod";

export const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
