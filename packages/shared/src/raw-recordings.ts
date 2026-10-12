import { z } from "zod";

/**
 * Экспериментальная запись урока (docs/experimental-recording.md): во время
 * урока сервис-рекордер сохраняет медиадорожки как есть, сервер ведёт журнал
 * событий урока, а единый MP4 собирается после урока отдельным рендером.
 * Основная запись — LiveKit Egress (`recordings.ts`), её схемы не меняются.
 */

/**
 * Метод записи урока. `egress` — основной, по умолчанию; `experimental` —
 * только новая архитектура; `both` — оба метода параллельно, только для
 * явно отмеченных тестовых уроков (двойная нагрузка).
 */
export const lessonRecordingModeSchema = z.enum(["egress", "experimental", "both"]);
export type LessonRecordingMode = z.infer<typeof lessonRecordingModeSchema>;

/**
 * Жизненный цикл экспериментальной записи — своё состояние, не смешивается
 * с `recordings.status`:
 * - `requested`         — ждёт, пока рекордер возьмёт задание;
 * - `recording`         — рекордер пишет дорожки (держит лизу, шлёт heartbeat);
 * - `finalizing`        — стоп запрошен, рекордер дописывает и закрывает файлы;
 * - `queued_for_render` — данные готовы, ждёт рендер;
 * - `rendering`         — рендер собирает MP4 (держит свою лизу);
 * - `verifying`         — MP4 собран, идёт проверка перед публикацией;
 * - `ready`             — MP4 проверен и опубликован;
 * - `failed`            — не вышло (причина в `lastError`), исходники сохранены;
 * - `aborted`           — остановлено до появления данных;
 * - `deleted`           — файлы удалены по ретеншну.
 */
export const rawRecordingStatusSchema = z.enum([
  "requested",
  "recording",
  "finalizing",
  "queued_for_render",
  "rendering",
  "verifying",
  "ready",
  "failed",
  "aborted",
  "deleted",
]);
export type RawRecordingStatus = z.infer<typeof rawRecordingStatusSchema>;

/** Статусы, пока идёт урок: баннер согласия виден, журнал пишется. */
export const ACTIVE_RAW_RECORDING_STATUSES: readonly RawRecordingStatus[] = ["requested", "recording"];

/**
 * Виды событий журнала. Время — серверные часы хоста (`tsMs`, Unix мс); тот
 * же источник времени, что метки прихода RTP-пакетов у рекордера (один
 * хост, общие системные часы) — так журнал и медиа ложатся на одну шкалу.
 */
export const journalEventKindSchema = z.enum([
  /** Журнал начат (`payload.reason`: `start` или `resume` после рестарта API). */
  "journal_started",
  /** Раз в 10 с: процесс API жив и пишет журнал — по дыркам видна неполнота. */
  "journal_heartbeat",
  "journal_stopped",
  /** WS-сообщение урока (`ServerRoomMessage`), кроме чата. */
  "room_event",
  /** Вебхук LiveKit: участник/дорожка (`participant_*`, `track_*`). */
  "livekit_event",
  /** Состояние урока на момент начала журнала: сцена, участники. */
  "lesson_snapshot",
  /** Полное состояние Y.Doc доски (`data`), ключевой кадр. */
  "yjs_snapshot",
  /** Инкрементальный Yjs-update доски (`data`). */
  "yjs_update",
  /** Viewport доски у того, за кем следует запись (awareness `viewport`). */
  "viewport",
  /** Вид задания в записи (`RecorderActivityView`) — при изменении. */
  "activity_view",
]);
export type JournalEventKind = z.infer<typeof journalEventKindSchema>;

export const journalEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  tsMs: z.number().int(),
  kind: journalEventKindSchema,
  payload: z.unknown().nullable(),
  /** Двоичные данные (Yjs) в base64. */
  data: z.string().nullable(),
});
export type JournalEvent = z.infer<typeof journalEventSchema>;

export const journalPageSchema = z.object({
  events: z.array(journalEventSchema),
  /** Передать как `afterSeq` за следующей страницей; `null` — страниц больше нет. */
  nextAfterSeq: z.number().int().nullable(),
});
export type JournalPage = z.infer<typeof journalPageSchema>;

// ─── Внутренний API рекордера и рендера (`/internal/raw-recorder/*`) ───────

export const rawVideoQualitySchema = z.enum(["low", "medium", "high"]);

export const rawRecordClaimRequestSchema = z.object({
  workerId: z.string().min(1).max(200),
});

export const rawRecordJobSchema = z.object({
  recordingId: z.string().uuid(),
  lessonId: z.string().uuid(),
  /** Номер попытки записи: после падения рекордера урок дописывается новой попыткой в свой каталог. */
  attempt: z.number().int().positive(),
  leaseId: z.string().uuid(),
  livekitUrl: z.string().min(1),
  livekitToken: z.string().min(1),
  /** Каталог попытки относительно STORAGE_ROOT. */
  attemptDir: z.string().min(1),
  /** Жёсткий предел длительности записи на стороне рекордера. */
  maxDurationSec: z.number().int().positive(),
  cameraQuality: rawVideoQualitySchema,
  screenQuality: rawVideoQualitySchema,
  heartbeatIntervalSec: z.number().int().positive(),
});
export type RawRecordJob = z.infer<typeof rawRecordJobSchema>;

export const rawRecorderStatsSchema = z.object({
  tracks: z.number().int().nonnegative(),
  packets: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  /** Пропуски по номерам RTP-пакетов, которые так и не пришли. */
  lostPackets: z.number().int().nonnegative(),
  keyframeRequests: z.number().int().nonnegative(),
});
export type RawRecorderStats = z.infer<typeof rawRecorderStatsSchema>;

export const rawRecordHeartbeatRequestSchema = z.object({
  leaseId: z.string().uuid(),
  stats: rawRecorderStatsSchema,
});

export const rawRecordHeartbeatResponseSchema = z.object({
  /** `true` — запись остановлена (учителем, комната закрылась): закрыть файлы и отчитаться. */
  stop: z.boolean(),
});

export const rawRecordFinishedRequestSchema = z.object({
  leaseId: z.string().uuid(),
  reason: z.enum(["stopped", "room_closed", "max_duration", "error"]),
  error: z.string().max(2000).nullable(),
  stats: rawRecorderStatsSchema,
});

export const rawRenderClaimRequestSchema = z.object({
  workerId: z.string().min(1).max(200),
});

export const rawRenderJobSchema = z.object({
  recordingId: z.string().uuid(),
  lessonId: z.string().uuid(),
  leaseId: z.string().uuid(),
  attempt: z.number().int().positive(),
  /** Каталог записи относительно STORAGE_ROOT: `attempt-N/` с дорожками, `render/` — рабочий. */
  recordingDir: z.string().min(1),
  /** Куда опубликовать MP4 (относительно STORAGE_ROOT). */
  outputKey: z.string().min(1),
  /** Начало и конец шкалы записи, Unix мс (часы хоста). */
  t0Ms: z.number().int(),
  t1Ms: z.number().int(),
  /** Страница кадров доски/задания (`/recording-replay`) с токеном, абсолютный URL. */
  replayUrl: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  videoBitrateKbps: z.number().int().positive(),
});
export type RawRenderJob = z.infer<typeof rawRenderJobSchema>;

export const rawRenderHeartbeatRequestSchema = z.object({
  leaseId: z.string().uuid(),
  step: z.string().min(1).max(100),
});

export const rawRenderFinishedRequestSchema = z.object({
  leaseId: z.string().uuid(),
  durationSec: z.number().nonnegative(),
  sizeBytes: z.number().int().positive(),
  /** Измерения рендера (время шагов, CPU, объёмы) — для сравнения с Egress. */
  metrics: z.record(z.union([z.number(), z.string(), z.boolean()])),
});

export const rawRenderFailedRequestSchema = z.object({
  leaseId: z.string().uuid(),
  error: z.string().max(4000),
  /** `false` — повтор не поможет (нет данных, битый журнал): сразу `failed`. */
  retryable: z.boolean(),
});

/** Ответ `GET /raw-recordings/:id/replay` странице кадров (`/recording-replay`). */
export const rawReplayDataSchema = z.object({
  recordingId: z.string().uuid(),
  lessonId: z.string().uuid(),
  /** За кем следует viewport доски в записи — тот, кто запустил запись. */
  followUserId: z.string().uuid(),
  t0Ms: z.number().int(),
  t1Ms: z.number().int(),
  events: z.array(journalEventSchema),
});
export type RawReplayData = z.infer<typeof rawReplayDataSchema>;

// ─── Администрирование ─────────────────────────────────────────────────────

export const setLessonRecordingModeRequestSchema = z.object({
  mode: lessonRecordingModeSchema,
});

export const lessonRecordingModeResponseSchema = z.object({
  lessonId: z.string().uuid(),
  /** Режим, который реально применится к следующей записи (с учётом допуска школы). */
  effectiveMode: lessonRecordingModeSchema,
  /** Что сохранено для урока (`null` — ничего, работает основная запись). */
  storedMode: lessonRecordingModeSchema.nullable(),
  /** Допущена ли школа к экспериментальной записи на этом сервере. */
  schoolAllowed: z.boolean(),
});
export type LessonRecordingModeResponse = z.infer<typeof lessonRecordingModeResponseSchema>;

export const rawRecordingDetailSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  status: rawRecordingStatusSchema,
  attempt: z.number().int(),
  renderAttempts: z.number().int(),
  renderStep: z.string().nullable(),
  lastError: z.string().nullable(),
  /** id записи Egress того же урока, если шли оба метода (`both`). */
  compareRecordingId: z.string().uuid().nullable(),
  startedAt: z.string().datetime(),
  stoppedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  durationSec: z.number().nullable(),
  sizeBytes: z.number().int().nullable(),
  recorderStats: rawRecorderStatsSchema.nullable(),
  renderMetrics: z.record(z.union([z.number(), z.string(), z.boolean()])).nullable(),
  journalEvents: z.number().int().nonnegative(),
  url: z.string().nullable(),
});
export type RawRecordingDetail = z.infer<typeof rawRecordingDetailSchema>;
