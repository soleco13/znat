import { z } from "zod";
import { roleSchema } from "./roles.js";

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  role: roleSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const accessTokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  schoolId: z.string().uuid(),
  role: roleSchema,
});
export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;
