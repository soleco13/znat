import type {
  PlatformExtendRequest,
  PlatformOverview,
  PlatformPayment,
  PlatformSchool,
  PlatformSchoolDetail,
  PlatformUser,
} from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

export const getOverview = () => apiFetch<PlatformOverview>("/platform/overview");
export const getSchools = () => apiFetch<PlatformSchool[]>("/platform/schools");
export const getSchool = (id: string) => apiFetch<PlatformSchoolDetail>(`/platform/schools/${id}`);
export const getPayments = () => apiFetch<PlatformPayment[]>("/platform/payments");
export const getUsers = (q: string) => apiFetch<PlatformUser[]>(`/platform/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
export const extendSchool = (id: string, body: PlatformExtendRequest) =>
  apiFetch<PlatformSchoolDetail>(`/platform/schools/${id}/extend`, { method: "POST", body: JSON.stringify(body) });
