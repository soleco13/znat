import type {
  IndividualRegisterRequest,
  OrganizationRegisterRequest,
  RegisterResponse,
  SchoolPublicInfo,
  VerifyEmailResponse,
} from "@school/shared";

import { apiFetch } from "@/shared/api-client";

/** Э14.1 — self-signup репетитора (физлицо, без организации). */
export function registerIndividual(input: IndividualRegisterRequest): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>("/auth/register/individual", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Э14.1 — self-signup ООО: создаёт новое именованное пространство. */
export function registerOrganization(input: OrganizationRegisterRequest): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>("/auth/register/organization", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Подтверждение почты по ссылке из письма — сразу возвращает сессию (автологин). */
export function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  return apiFetch<VerifyEmailResponse>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** Повторная отправка письма подтверждения — ответ одинаковый, есть аккаунт или нет. */
export function resendVerification(email: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Публичная визитка пространства (`/s/:slug`). */
export function getSpacePublicInfo(slug: string): Promise<SchoolPublicInfo> {
  return apiFetch<SchoolPublicInfo>(`/spaces/${encodeURIComponent(slug)}`);
}
