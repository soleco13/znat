import { z } from "zod";
import { roleSchema } from "./roles.js";

/**
 * Email всегда в нижнем регистре и без пробелов по краям: `Ivan@x.ru` и
 * `ivan@x.ru` — один человек. Без нормализации это были два аккаунта, а
 * вход с другим регистром букв не находил пользователя.
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.string().email().max(254));

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
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
