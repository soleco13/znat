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
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

