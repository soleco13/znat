import type {
  CreateInviteRequest,
  CreateInviteResponse,
  InvitePublicInfo,
  InviteSummary,
} from "@school/shared";

import { apiFetch } from "@/shared/api-client";

/** Э14.2 — приглашения в пространство, только admin (§ план-ТЗ Э14). */
export function listInvites(): Promise<{ items: InviteSummary[] }> {
  return apiFetch<{ items: InviteSummary[] }>("/invites");
}

export function createInvite(input: CreateInviteRequest): Promise<CreateInviteResponse> {
  return apiFetch<CreateInviteResponse>("/invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeInvite(id: string): Promise<void> {
  return apiFetch<void>(`/invites/${id}/revoke`, { method: "POST" });
}

/** Публичный предпросмотр инвайта (страница приёма приглашения, до регистрации). */
export function getInvitePublicInfo(code: string): Promise<InvitePublicInfo> {
  return apiFetch<InvitePublicInfo>(`/invites/${encodeURIComponent(code)}`);
}
