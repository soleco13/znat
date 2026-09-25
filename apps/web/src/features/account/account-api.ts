import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  MeResponse,
  ResetPasswordRequest,
} from "@school/shared";

import { apiFetch } from "@/shared/api-client";

export function requestPasswordReset(body: ForgotPasswordRequest): Promise<{ ok: true }> {
  return apiFetch("/auth/password/forgot", { method: "POST", body: JSON.stringify(body) });
}

export function resetPassword(body: ResetPasswordRequest): Promise<{ ok: true }> {
  return apiFetch("/auth/password/reset", { method: "POST", body: JSON.stringify(body) });
}

/** Смена пароля: сервер отзывает остальные сессии и выдаёт этой вкладке новую. */
export function changePassword(body: ChangePasswordRequest): Promise<{ accessToken: string; user: MeResponse }> {
  return apiFetch("/auth/password/change", { method: "POST", body: JSON.stringify(body) });
}
