import { z } from "zod";
import { roleSchema } from "./roles.js";
import { emailSchema } from "./auth.js";

export const createUserRequestSchema = z.object({
  email: emailSchema,
  fullName: z.string().min(1).max(200),
  role: roleSchema,
  password: z.string().min(8).max(200),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  role: roleSchema.optional(),
  /**
   * Э15.2: роли в школе набором — учитель и методист совмещаются;
   * администратор — самостоятельная роль, без других (docs/roles §4).
   */
  roles: z
    .array(roleSchema)
    .min(1)
    .max(2)
    .refine((r) => !r.includes("admin") || r.length === 1, { message: "Администратор не совмещается с другими ролями" })
    .optional(),
  /** false — прекратить членство в школе (аккаунт и личный кабинет сохраняются), true — вернуть. */
  isActive: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const listUsersQuerySchema = z.object({
  role: roleSchema.optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  role: roleSchema,
  roles: z.array(roleSchema).default([]),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

