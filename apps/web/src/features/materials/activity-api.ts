import type { ActivityDto, CreateActivityRequest, MyActivity } from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

/**
 * Клиент выдачи заданий (Э8.6, §8 ТЗ). Материал и ответы ходят по этим
 * индивидуальным HTTP-эндпоинтам — НЕ через Y.Doc урока: у каждого ученика
 * своя копия (`/my`), свой `attemptId`, свой порядок вариантов.
 */

/** Учитель: запустить материал для класса текущего урока. */
export function createActivity(lessonId: string, body: CreateActivityRequest): Promise<ActivityDto> {
  return apiFetch<ActivityDto>(`/lessons/${lessonId}/activities`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Список выдач урока — фолбэк-поллинг, если WS-сигнал `activity_started` пропущен. */
export function listLessonActivities(lessonId: string): Promise<{ items: ActivityDto[] }> {
  return apiFetch<{ items: ActivityDto[] }>(`/lessons/${lessonId}/activities`);
}

/** Ученик/учитель: своя копия задания без ключей ответов + ранее сохранённые черновики. */
export function getMyActivity(activityId: string): Promise<MyActivity> {
  return apiFetch<MyActivity>(`/activities/${activityId}/my`);
}
