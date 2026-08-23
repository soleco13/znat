import { z } from "zod";
import { roleSchema } from "./roles.js";

export const createUserRequestSchema = z.object({
  email: z.string().email(),
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

export const createGroupRequestSchema = z.object({
  name: z.string().min(1).max(200),
  grade: z.number().int().min(1).max(11),
  academicYear: z.string().min(1).max(20),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const addGroupMembersRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
});
export type AddGroupMembersRequest = z.infer<typeof addGroupMembersRequestSchema>;

export const importUsersRowSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: roleSchema,
  password: z.string().min(8),
});
export type ImportUsersRow = z.infer<typeof importUsersRowSchema>;
