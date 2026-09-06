import type {
  AdminCreateLessonRequest,
  LessonAttendance,
  LessonSummary,
  RotateLessonLinkResponse,
  UpdateLessonRequest,
  UserResponse,
} from "@school/shared";

import { apiFetch } from "@/shared/api-client";

export function listLessons(): Promise<{ items: LessonSummary[] }> {
  return apiFetch<{ items: LessonSummary[] }>("/lessons");
}

/** Список учителей для закрепления урока (только admin). */
export function listTeachers(): Promise<UserResponse[]> {
  return apiFetch<{ items: UserResponse[]; total: number }>(
    "/users?role=teacher&pageSize=200",
  ).then((r) => r.items.filter((u) => u.isActive));
}

export function createLesson(body: AdminCreateLessonRequest): Promise<LessonSummary> {
  return apiFetch<LessonSummary>("/lessons", { method: "POST", body: JSON.stringify(body) });
}

export function updateLesson(id: string, body: UpdateLessonRequest): Promise<LessonSummary> {
  return apiFetch<LessonSummary>(`/lessons/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteLesson(id: string): Promise<void> {
  return apiFetch<void>(`/lessons/${id}`, { method: "DELETE" });
}

export function rotateJoinLink(id: string): Promise<RotateLessonLinkResponse> {
  return apiFetch<RotateLessonLinkResponse>(`/lessons/${id}/link/rotate`, { method: "POST" });
}

export function getAttendance(id: string): Promise<LessonAttendance> {
  return apiFetch<LessonAttendance>(`/lessons/${id}/attendance`);
}
