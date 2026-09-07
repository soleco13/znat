import type {
  AdminCreateLessonRequest,
  LessonAttendance,
  LessonMaterial,
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

/** «Домашка» урока — список материалов, доступных ученику по ссылке (Э12.8). */
export function listLessonMaterials(id: string): Promise<{ items: LessonMaterial[] }> {
  return apiFetch<{ items: LessonMaterial[] }>(`/lessons/${id}/materials`);
}

export function assignLessonMaterial(id: string, materialId: string): Promise<{ items: LessonMaterial[] }> {
  return apiFetch<{ items: LessonMaterial[] }>(`/lessons/${id}/materials`, {
    method: "POST",
    body: JSON.stringify({ materialId }),
  });
}

export function unassignLessonMaterial(id: string, materialId: string): Promise<void> {
  return apiFetch<void>(`/lessons/${id}/materials/${materialId}`, { method: "DELETE" });
}

/** Сколько человек сейчас в каждом из перечисленных уроков (Э12 полировка). */
export function getPresenceCounts(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return Promise.resolve({});
  const qs = ids.map(encodeURIComponent).join(",");
  return apiFetch<{ counts: Record<string, number> }>(`/lessons/presence-counts?ids=${qs}`).then(
    (r) => r.counts,
  );
}
