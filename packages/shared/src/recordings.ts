import { z } from "zod";
import type { PublicMaterial } from "./materials.js";
import type { ActivityProgress } from "./activities.js";

/**
 * Э10 — Запись уроков (§10.4 ТЗ). Формат — общий для фронта и бэка, без
 * логики (CLAUDE.md). Запись идёт через LiveKit Egress на ВТОРОЙ машине
 * (RoomComposite съедает 2–6 CPU + headless-Chrome, на монолит не
 * помещается) — эти схемы описывают то, что API отдаёт клиенту, а не то,
 * как устроен egress.
 */

/**
 * Жизненный цикл записи. Сжатая проекция `livekit.EgressStatus` (7
 * значений) на то, что различает пользователь:
 * - `starting`   — egress запрошен, файл ещё не пишется (EGRESS_STARTING)
 * - `recording`  — идёт запись (EGRESS_ACTIVE)
 * - `processing` — запись остановлена, файл финализируется/выгружается
 *                  (EGRESS_ENDING)
 * - `ready`      — файл в хранилище, доступен по presigned-ссылке
 *                  (EGRESS_COMPLETE)
 * - `failed`     — egress упал или уперся в лимит
 *                  (EGRESS_FAILED / EGRESS_LIMIT_REACHED)
 * - `aborted`    — остановлен до появления пригодного файла (EGRESS_ABORTED)
 * - `deleted`    — файл удалён по ретеншну (30–90 дней), строка оставлена
 *                  для журнала; своего значения в EgressStatus нет
 */
export const recordingStatusSchema = z.enum([
  "starting",
  "recording",
  "processing",
  "ready",
  "failed",
  "aborted",
  "deleted",
]);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;

/** Статусы, в которых запись ещё «живая» на стороне egress (можно/нужно останавливать). */
export const ACTIVE_RECORDING_STATUSES: readonly RecordingStatus[] = ["starting", "recording"];

/** Терминальные статусы — egress больше ничего с записью не сделает. */
export const TERMINAL_RECORDING_STATUSES: readonly RecordingStatus[] = [
  "ready",
  "failed",
  "aborted",
  "deleted",
];

export const recordingSummarySchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  status: recordingStatusSchema,
  /** Длительность готового файла. `null`, пока запись не финализирована. */
  durationSec: z.number().int().nonnegative().nullable(),
  /** Размер файла в хранилище. `null` до финализации и после удаления по ретеншну. */
  sizeBytes: z.number().int().nonnegative().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  /**
   * Когда файл будет удалён по ретеншну (§10.10 ТЗ: «ретеншн 90 дней»).
   * `null`, если запись ещё не `ready` или уже `deleted`.
   */
  expiresAt: z.string().datetime().nullable(),
});
export type RecordingSummary = z.infer<typeof recordingSummarySchema>;

/**
 * Запись вместе с presigned-ссылкой на скачивание (§10.10 ТЗ: «только
 * presigned URL с TTL 1 час, доступ по роли, ученикам — нет»). `url` !==
 * null только при `status === "ready"` И роль запросившего это позволяет
 * (проверяется на сервере, не здесь).
 */
export const recordingWithDownloadSchema = recordingSummarySchema.extend({
  url: z.string().url().nullable(),
  /** Момент протухания `url`. `null`, если `url === null`. */
  urlExpiresAt: z.string().datetime().nullable(),
});
export type RecordingWithDownload = z.infer<typeof recordingWithDownloadSchema>;

export const lessonRecordingsResponseSchema = z.object({
  /** Идёт ли запись прямо сейчас — для баннера согласия и кнопки «Стоп». */
  active: recordingSummarySchema.nullable(),
  /** Все записи урока, новые сверху. */
  recordings: z.array(recordingWithDownloadSchema),
});
export type LessonRecordingsResponse = z.infer<typeof lessonRecordingsResponseSchema>;

/**
 * Э10.3 — старт записи. Тело пустое: что и как писать (layout, битрейт,
 * формат) — решает сервер по конфигу, не клиент. Ответ — созданная
 * запись в статусе `starting`.
 */
export const startRecordingResponseSchema = recordingSummarySchema;
export type StartRecordingResponse = z.infer<typeof startRecordingResponseSchema>;

export const stopRecordingResponseSchema = recordingSummarySchema;
export type StopRecordingResponse = z.infer<typeof stopRecordingResponseSchema>;

/**
 * Э10.6 — recorder-токен. Минтится ОДИН раз при старте RoomComposite Egress
 * вместе с LiveKit access-токеном (`apps/api/recordings/service.ts`) и уходит
 * headless-Chrome шаблону записи (`/egress`) через `customBaseUrl` — тот же
 * приём, что `GUEST_CANVAS_TOKEN_MARKER`, но recorder не прячет токен за
 * куку (страница `/egress` не публичная, читает свой же query-параметр).
 *
 * Даёт read-only доступ ровно к тому, что нужно для композитинга кадра
 * записи — WS-сигналам стейджа урока, доске (Hocuspocus, read-only),
 * агрегированному виду текущего задания (`RecorderActivityView` ниже).
 * НЕ персонал: не проходит `app.authenticate`/`requireRole`, не видит
 * ключи ответов, не попадает в presence/посещаемость урока.
 */
export const recorderTokenPayloadSchema = z.object({
  typ: z.literal("recorder"),
  lessonId: z.string().uuid(),
  /**
   * `recordings.id` (наш собственный UUID, не LiveKit `egressId`) — минтится
   * ДО вызова `startRoomCompositeEgress`, потому что сам `egressId` LiveKit
   * выдаёт только в ответ на этот вызов, а токен должен уйти внутрь его
   * параметров (`customBaseUrl`). Токен привязан к одному запуску записи.
   */
  recordingId: z.string().uuid(),
});
export type RecorderTokenPayload = z.infer<typeof recorderTokenPayloadSchema>;

/**
 * Ответ `GET /activities/:id/recorder-view` — «лист с заданиями» в записи
 * урока, когда стейдж = activity. Решение пользователя (2026-09-11):
 * учительский вид мониторинга — материал БЕЗ ключей ответов
 * (`stripMaterialAnswerKeys`) + агрегированный прогресс класса, ни одного
 * личного ответа ученика и ни одного ключа.
 */
export interface RecorderActivityView {
  activityId: string;
  materialTitle: string;
  material: PublicMaterial;
  progress: ActivityProgress;
}
