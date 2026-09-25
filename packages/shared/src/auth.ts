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

/**
 * Согласие на обработку персональных данных (152-ФЗ) — без него не
 * регистрируем и не пускаем гостя в урок. Только `true`: снятая галочка
 * отклоняется схемой.
 */
export const personalDataConsentSchema = z.literal(true, {
  errorMap: () => ({ message: "Нужно согласие на обработку персональных данных" }),
});

/** Требования к новому паролю — те же, что при регистрации. */
export const newPasswordSchema = z.string().min(8, "Пароль — не короче 8 символов").max(200);

/** «Забыли пароль?» — ответ одинаковый, есть такой аккаунт или нет. */
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** Новый пароль по ссылке из письма. */
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Смена пароля вошедшим пользователем — с подтверждением текущего. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

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
