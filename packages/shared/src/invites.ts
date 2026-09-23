import { z } from "zod";
import { roleSchema } from "./roles.js";

/**
 * Э14.2 — приглашение в чужое пространство. Только по ссылке/коду от
 * админа (не открытый поиск) — решено в переписке до реализации.
 */
export const createInviteRequestSchema = z.object({
  role: roleSchema,
  maxUses: z.number().int().min(1).max(1000).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

/** Ответ создания инвайта — сырой код/ссылка показываются РОВНО ОДИН РАЗ, дальше хранится только хэш. */
export const createInviteResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  url: z.string(),
  role: roleSchema,
  maxUses: z.number().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

/** Строка в админ-списке инвайтов — БЕЗ сырого кода (хранится только хэш, восстановить нельзя). */
export const inviteSummarySchema = z.object({
  id: z.string().uuid(),
  role: roleSchema,
  maxUses: z.number().nullable(),
  useCount: z.number(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InviteSummary = z.infer<typeof inviteSummarySchema>;

/** Публичный предпросмотр инвайта (`GET /invites/:code`) — до регистрации, без аутентификации. */
export const invitePublicInfoSchema = z.object({
  schoolName: z.string(),
  schoolSlug: z.string(),
  role: roleSchema,
  valid: z.boolean(),
});
export type InvitePublicInfo = z.infer<typeof invitePublicInfoSchema>;
