import type {
  AdminRecordingsListResponse,
  LessonRecordingsResponse,
  RecordingExternalLinkResponse,
  RecordingSummary,
  StorageUsageResponse,
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

// ─── Страница администратора «Записи» (§10.10 ТЗ) — весь архив школы ─────────

/** Только `admin` — весь архив школы одним списком, не по урокам. */
export function listAllRecordings(
  page: number,
  pageSize: number,
): Promise<AdminRecordingsListResponse> {
  return apiFetch<AdminRecordingsListResponse>(
    `/admin/recordings?page=${page}&pageSize=${pageSize}`,
  );
}

/** Место на диске хранилища + сколько из занятого — именно записи уроков. */
export function getStorageUsage(): Promise<StorageUsageResponse> {
  return apiFetch<StorageUsageResponse>("/admin/recordings/storage-usage");
}

/** Абсолютная ссылка на скачивание для отправки за пределы приложения (дольше TTL, чем обычная). */
export function createExternalDownloadLink(
  recordingId: string,
  ttlSeconds?: number,
): Promise<RecordingExternalLinkResponse> {
  const qs = ttlSeconds ? `?ttlSeconds=${ttlSeconds}` : "";
  return apiFetch<RecordingExternalLinkResponse>(
    `/admin/recordings/${recordingId}/external-link${qs}`,
  );
}

/** Удалить запись из хранилища немедленно (не дожидаясь ретеншна). Активную запись нужно сначала остановить. */
export function adminDeleteRecording(recordingId: string): Promise<void> {
  return apiFetch<void>(`/admin/recordings/${recordingId}`, { method: "DELETE" });
}
