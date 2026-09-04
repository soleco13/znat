import type {
  ActivityAnalytics,
  ActivityDto,
  ActivityProgress,
  ActivityReview,
  CreateActivityRequest,
  MyActivity,
  PushAnswerToBoardRequest,
  ReviewQuestionResponses,
  SaveResponseRequest,
  SaveResponseResult,
  StartReviewResult,
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

/** Учитель: задать домашнюю работу группе напрямую, без урока (Э8.11). */
export function assignHomework(groupId: string, body: CreateActivityRequest): Promise<ActivityDto> {
  return apiFetch<ActivityDto>(`/groups/${groupId}/activities`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Список домашних заданий группы (Э8.11) — ученик видит свои, учитель/админ школы видит все. */
export function listGroupActivities(groupId: string): Promise<{ items: ActivityDto[] }> {
  return apiFetch<{ items: ActivityDto[] }>(`/groups/${groupId}/activities`);
}

/** Учитель: живая картина класса по заданию (Э8.8). Опрашивается панелью прогресса раз в несколько секунд. */
export function getActivityProgress(activityId: string): Promise<ActivityProgress> {
  return apiFetch<ActivityProgress>(`/activities/${activityId}/progress`);
}

/** Учитель: агрегированная аналитика по вопросам — гистограмма ответов (Э8.9). */
export function getActivityAnalytics(activityId: string): Promise<ActivityAnalytics> {
  return apiFetch<ActivityAnalytics>(`/activities/${activityId}/analytics`);
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

/** Учитель: начать разбор задания (Э8.10) — открывает правильные ответы всем участникам урока. */
export function startActivityReview(activityId: string): Promise<StartReviewResult> {
  return apiFetch<StartReviewResult>(`/activities/${activityId}/review`, { method: "POST" });
}

/** Ученик/учитель: полный материал с правильными ответами — только после начала разбора (иначе 409). */
export function getActivityReview(activityId: string): Promise<ActivityReview> {
  return apiFetch<ActivityReview>(`/activities/${activityId}/review`);
}

/** Учитель: ответы класса на один вопрос, с именами — выбрать, чей вынести на доску. */
export function getReviewQuestionResponses(
  activityId: string,
  questionId: string,
): Promise<ReviewQuestionResponses> {
  return apiFetch<ReviewQuestionResponses>(
    `/activities/${activityId}/review/questions/${encodeURIComponent(questionId)}/responses`,
  );
}

/** Учитель: вынести ответ одного ученика на доску урока — анонимно или с именем (§7.3 ТЗ). */
export function pushAnswerToBoard(activityId: string, body: PushAnswerToBoardRequest): Promise<void> {
  return apiFetch<void>(`/activities/${activityId}/review/board`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
