import type {
  ActivityDto,
  ActivityProgress,
  CreateActivityRequest,
  MyActivity,
  SaveResponseRequest,
  SaveResponseResult,
} from "@school/shared";
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

/** Учитель: живая картина класса по заданию (Э8.8). Опрашивается панелью прогресса раз в несколько секунд. */
export function getActivityProgress(activityId: string): Promise<ActivityProgress> {
  return apiFetch<ActivityProgress>(`/activities/${activityId}/progress`);
}

/** Ученик/учитель: своя копия задания без ключей ответов + ранее сохранённые черновики. */
export function getMyActivity(activityId: string): Promise<MyActivity> {
  return apiFetch<MyActivity>(`/activities/${activityId}/my`);
}

/**
 * Ученик: автосохранение черновика одного ответа (Э8.7). Идемпотентно —
 * повтор той же отправки безопасен. `keepalive` — для отправки при выгрузке
 * вкладки (`visibilitychange`/`beforeunload`), чтобы браузер не оборвал запрос.
 */
export function saveResponse(
  activityId: string,
  body: SaveResponseRequest,
  keepalive = false,
): Promise<SaveResponseResult> {
  return apiFetch<SaveResponseResult>(`/activities/${activityId}/responses`, {
    method: "POST",
    body: JSON.stringify(body),
    keepalive,
  });
}
