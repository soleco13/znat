import { z } from "zod";
import { validateInn, validateOgrn } from "./inn-ogrn.js";
import { emailSchema, meResponseSchema, personalDataConsentSchema } from "./auth.js";

/**
 * Э14.1 — публичная self-signup регистрация репетитора (физлицо, без
 * организации). `inviteCode` уже в схеме (задел под Э14.2 — присоединение к
 * чужому пространству по инвайт-ссылке), но в Э14.1 сервис его ещё не
 * обрабатывает.
 */
export const individualRegisterRequestSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: emailSchema,
  password: z.string().min(8).max(200),
  inviteCode: z.string().min(1).optional(),
  personalDataConsent: personalDataConsentSchema,
});
export type IndividualRegisterRequest = z.infer<typeof individualRegisterRequestSchema>;

/** Э14.1 — регистрация ООО: создаёт новое именованное пространство. ИНН/ОГРН — формат+контрольная сумма, без сверки с ЕГРЮЛ. */
export const organizationRegisterRequestSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: emailSchema,
  password: z.string().min(8).max(200),
  orgName: z.string().min(1).max(200),
  inn: z.string().refine(validateInn, { message: "Некорректный ИНН" }),
  ogrn: z.string().refine(validateOgrn, { message: "Некорректный ОГРН" }),
  personalDataConsent: personalDataConsentSchema,
});
export type OrganizationRegisterRequest = z.infer<typeof organizationRegisterRequestSchema>;

/** Ответ обоих self-signup эндпоинтов: аккаунт создан, письмо отправлено, ждём подтверждения. */
export const registerResponseSchema = z.object({
  status: z.literal("pending_verification"),
  email: z.string().email(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

/** Повторная отправка письма подтверждения — ответ одинаковый, есть такой аккаунт или нет. */
export const resendVerificationRequestSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/** Ответ подтверждения почты — автологин, та же форма, что и у `POST /auth/login`. */
export const verifyEmailResponseSchema = z.object({
  accessToken: z.string(),
  user: meResponseSchema,
});
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;
