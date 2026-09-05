import type {
  LessonRecordingsResponse,
  RecordingSummary,
} from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

/**
 * Клиент записи уроков (Э10.3/10.4, §10.4/§10.10 ТЗ). Ученик сюда не ходит
 * вообще — сервер отвечает 403 (`assertRecordingAccess`); ученик узнаёт о
 * записи только по WS-сигналу `recording_status` (баннер согласия).
 * Скачивание готовых файлов — только по presigned-ссылке из ответа
 * `getLessonRecordings`, прямых путей к файлам на клиенте нет.
 */

/** Учитель/админ/методист: активная запись + список всех записей урока с presigned-ссылками. */
export function getLessonRecordings(lessonId: string): Promise<LessonRecordingsResponse> {
  return apiFetch<LessonRecordingsResponse>(`/lessons/${lessonId}/recordings`);
}

/** Учитель урока/админ: начать запись. 503, если запись не включена (нет второй машины). */
export function startLessonRecording(lessonId: string): Promise<RecordingSummary> {
  return apiFetch<RecordingSummary>(`/lessons/${lessonId}/recordings`, { method: "POST" });
}

/** Учитель урока/админ: остановить запись. Файл финализируется асинхронно (статус → `processing` → `ready`). */
export function stopLessonRecording(
  lessonId: string,
  recordingId: string,
): Promise<RecordingSummary> {
  return apiFetch<RecordingSummary>(`/lessons/${lessonId}/recordings/${recordingId}/stop`, {
    method: "POST",
  });
}
