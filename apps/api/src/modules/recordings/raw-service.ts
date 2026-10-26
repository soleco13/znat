import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import type {
  AccessTokenPayload,
  JournalEvent,
  JournalPage,
  LessonRecordingMode,
  LessonRecordingModeResponse,
  RawRecordJob,
  RawRecorderStats,
  RawRecordingDetail,
  RawRecordingStatus,
  RawRenderJob,
  RawReplayData,
  RecorderTokenPayload,
  RecordingStatus,
  RecordingSummary,
  RecordingWithDownload,
} from "@school/shared";
import { ACTIVE_RAW_RECORDING_STATUSES } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { env } from "../../plugins/env.js";
import { logEvent, logTaskFailure, logger } from "../../plugins/logger.js";
import * as billingService from "../billing/service.js";
import * as lessonsService from "../lessons/service.js";
import * as roomsService from "../rooms/service.js";
import * as schoolSettingsService from "../school-settings/service.js";
import { signRecorderToken } from "../recorder-auth/service.js";
import { deleteFile, deleteTree, getSignedFileUrl, statFile } from "../storage/service.js";
import { enqueuePoster, posterExists, posterKeyFor, removePoster } from "./poster.js";
import * as journal from "./journal.js";
import * as rawRepo from "./raw-repo.js";
import type { RawRecordingRow } from "./raw-repo.js";

/**
 * Экспериментальная запись (docs/experimental-recording.md) — второй,
 * независимый путь рядом с Egress. Своё состояние (`raw_recordings`), свои
 * статусы, ошибки и повторы. Ничего здесь не трогает строки `recordings`
 * и не вызывает egress: сбой этого пути не может остановить основную запись.
 */

/** Рекордер считается пропавшим без heartbeat дольше этого. */
const RECORDER_LEASE_TTL_MS = 30_000;
/** Рендер считается пропавшим без heartbeat дольше этого. */
const RENDER_LEASE_TTL_MS = 3 * 60_000;
export const MAX_RENDER_ATTEMPTS = 3;
const RECORDER_HEARTBEAT_SEC = 5;
/** Исходники упавшей сборки храним дольше — для разбора и ручной пересборки. */
const FAILED_SOURCE_RETENTION_MS = 14 * 24 * 3600_000;

/**
 * Когда удалить новую запись (обоих методов): срок хранения по тарифу школы,
 * без срока в тарифе — настройка сервера `RECORDING_RETENTION_DAYS`.
 */
export async function recordingExpiresAt(schoolId: string, from: Date): Promise<Date> {
  const { limits } = await billingService.planLimits(schoolId);
  return new Date(from.getTime() + (limits.recordingRetentionDays ?? env.RECORDING_RETENTION_DAYS) * 86_400_000);
}

// ─── Включение метода ──────────────────────────────────────────────────────

/** Метод вообще включён на этом сервере (есть секрет внутреннего API). */
export function experimentalRecordingEnabled(): boolean {
  return !!env.RAW_RECORDER_SECRET;
}

export function isSchoolAllowedForExperimental(schoolId: string): boolean {
  if (!experimentalRecordingEnabled()) return false;
  const allowed: readonly string[] = env.RECORDING_EXPERIMENTAL_SCHOOL_IDS;
  return allowed[0] === "all" || allowed.includes(schoolId);
}

/**
 * Метод записи урока. По умолчанию и при любой ошибке — `egress`: сбой
 * чтения настройки не должен оставить урок без основной записи.
 */
export async function resolveRecordingMode(schoolId: string, lessonId: string): Promise<LessonRecordingMode> {
  if (!isSchoolAllowedForExperimental(schoolId)) return "egress";
  try {
    return (await rawRepo.findLessonMode(lessonId)) ?? "egress";
  } catch (err) {
    logTaskFailure("recordings.resolve_mode", err, { lessonId });
    return "egress";
  }
}

export async function getLessonRecordingMode(
  user: AccessTokenPayload,
  lessonId: string,
): Promise<LessonRecordingModeResponse> {
  assertAdmin(user);
  await lessonsService.getLesson(user.schoolId, lessonId);
  const schoolAllowed = isSchoolAllowedForExperimental(user.schoolId);
  const storedMode = experimentalRecordingEnabled() ? await rawRepo.findLessonMode(lessonId) : null;
  return {
    lessonId,
    storedMode,
    schoolAllowed,
    effectiveMode: schoolAllowed ? (storedMode ?? "egress") : "egress",
  };
}

/**
 * Режим урока ставит только admin школы, допущенной на сервере
 * (`RECORDING_EXPERIMENTAL_SCHOOL_IDS`). `egress` — строку удаляем: урок
 * возвращается к поведению по умолчанию.
 */
export async function setLessonRecordingMode(
  user: AccessTokenPayload,
  lessonId: string,
  mode: LessonRecordingMode,
): Promise<LessonRecordingModeResponse> {
  assertAdmin(user);
  await lessonsService.getLesson(user.schoolId, lessonId);
  if (mode !== "egress" && !isSchoolAllowedForExperimental(user.schoolId)) {
    throw new AppError(
      403,
      "experimental_recording_not_allowed",
      "Экспериментальная запись не разрешена для этой школы на сервере",
    );
  }
  if (mode === "egress") {
    if (experimentalRecordingEnabled()) await rawRepo.deleteLessonMode(lessonId);
  } else {
    await rawRepo.upsertLessonMode({ lessonId, schoolId: user.schoolId, mode, setBy: user.sub });
  }
  logEvent("recording_mode_changed", { lessonId, mode, by: user.sub });
  return getLessonRecordingMode(user, lessonId);
}

function assertAdmin(user: AccessTokenPayload): void {
  if (user.role !== "admin") {
    throw new AppError(403, "forbidden", "Метод записи урока меняет только администратор");
  }
}

// ─── Старт и стоп ──────────────────────────────────────────────────────────

/**
 * Завести экспериментальную запись урока. Идемпотентно: уже идущая
 * возвращается как есть (уникальный индекс в БД страхует от гонки).
 * Рекордер возьмёт задание сам (опрос внутреннего API).
 */
export async function startRawRecording(input: {
  schoolId: string;
  lessonId: string;
  startedBy: string;
  livekitRoom: string;
  compareRecordingId: string | null;
}): Promise<RawRecordingRow> {
  const existing = await rawRepo.findActiveRawRecordingForLesson(input.lessonId);
  if (existing) return existing;
  const id = randomUUID();
  const inserted = await rawRepo.insertRawRecording({
    id,
    schoolId: input.schoolId,
    lessonId: input.lessonId,
    startedBy: input.startedBy,
    livekitRoom: input.livekitRoom,
    recordingDir: `raw-recordings/${input.schoolId}/${input.lessonId}/${id}`,
    outputKey: `recordings/${input.schoolId}/${input.lessonId}/${id}.mp4`,
    compareRecordingId: input.compareRecordingId,
  });
  const row = inserted ?? (await rawRepo.findActiveRawRecordingForLesson(input.lessonId));
  if (!row) throw new AppError(409, "raw_recording_conflict", "Экспериментальная запись не создана, повторите");
  if (inserted) {
    logEvent("raw_recording_requested", { recordingId: row.id, lessonId: row.lessonId, compareRecordingId: row.compareRecordingId });
    // Журнал — сразу, не ждать сверки через 5 с: начало урока самое важное.
    await journal.openJournalForRecording(row).catch((err: unknown) =>
      logTaskFailure("recordings.journal_open", err, { recordingId: row.id }),
    );
  }
  return row;
}

/** Остановить идущую экспериментальную запись урока. Идемпотентно. */
export async function requestRawStop(row: RawRecordingRow): Promise<RawRecordingRow> {
  if (!ACTIVE_RAW_RECORDING_STATUSES.includes(row.status)) return row;
  const now = new Date();
  let updated: RawRecordingRow | null;
  if (row.status === "requested") {
    // Рекордер ещё не взял задание — данных нет (attempt 0) или они от
    // прошлых попыток: решает сверка (`settleStoppedUnclaimed`).
    updated = await rawRepo.updateRawRecordingIf(row.id, ["requested"], { stopRequestedAt: now, stoppedAt: now });
  } else {
    updated = await rawRepo.updateRawRecordingIf(row.id, ["recording"], {
      status: "finalizing",
      stopRequestedAt: now,
      stoppedAt: now,
    });
  }
  await journal.closeJournalForRecording(row.id).catch((err: unknown) =>
    logTaskFailure("recordings.journal_close", err, { recordingId: row.id }),
  );
  if (updated?.status === "requested") await runRawSweepOnce();
  logEvent("raw_recording_stop_requested", { recordingId: row.id, lessonId: row.lessonId });
  return (await rawRepo.findRawRecording(row.id)) ?? updated ?? row;
}

export async function stopRawRecordingForLesson(lessonId: string): Promise<RawRecordingRow | null> {
  const row = await rawRepo.findActiveRawRecordingForLesson(lessonId);
  return row ? requestRawStop(row) : null;
}

/** Комната LiveKit закрылась — экспериментальную запись этой комнаты останавливаем. */
export async function handleRawRoomFinished(livekitRoom: string): Promise<void> {
  const rows = await rawRepo.listActiveRawRecordings();
  for (const row of rows) {
    if (row.livekitRoom === livekitRoom) await requestRawStop(row);
  }
}

export async function findRawRecordingForLesson(
  recordingId: string,
  lessonId: string,
  schoolId: string,
): Promise<RawRecordingRow | null> {
  const row = await rawRepo.findRawRecording(recordingId);
  return row && row.lessonId === lessonId && row.schoolId === schoolId ? row : null;
}

export async function findActiveRawRecording(lessonId: string): Promise<RawRecordingRow | null> {
  return rawRepo.findActiveRawRecordingForLesson(lessonId);
}

export async function listRawRecordingsForLesson(lessonId: string, schoolId: string): Promise<RawRecordingRow[]> {
  return rawRepo.listRawRecordingsForLesson(lessonId, schoolId);
}

// ─── Проекция на интерфейс записей урока ───────────────────────────────────

/**
 * Статус экспериментальной записи в шкале, которую понимает интерфейс
 * записей урока (`RecordingStatus`). Подробный статус — в
 * `GET /admin/raw-recordings/:id`.
 */
export function projectRawStatus(status: RawRecordingStatus): RecordingStatus {
  switch (status) {
    case "requested":
      return "starting";
    case "recording":
      return "recording";
    case "finalizing":
    case "queued_for_render":
    case "rendering":
    case "verifying":
      return "processing";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "deleted":
      return "deleted";
  }
}

export function toRawSummary(row: RawRecordingRow): RecordingSummary {
  return {
    id: row.id,
    lessonId: row.lessonId,
    status: projectRawStatus(row.status),
    durationSec: row.durationSec == null ? null : Math.round(row.durationSec),
    sizeBytes: row.sizeBytes,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    method: "experimental",
  };
}

export function toRawWithDownload(row: RawRecordingRow): RecordingWithDownload {
  const base = toRawSummary(row);
  if (row.status !== "ready") return { ...base, url: null, urlExpiresAt: null, posterUrl: null };
  return {
    ...base,
    url: getSignedFileUrl(row.outputKey, env.RECORDING_URL_TTL_SEC),
    urlExpiresAt: new Date(Date.now() + env.RECORDING_URL_TTL_SEC * 1000).toISOString(),
    posterUrl: null,
  };
}

/** То же, что `toRawWithDownload`, плюс обложка (если уже посчитана). */
export async function toRawWithDownloadAndPoster(row: RawRecordingRow): Promise<RecordingWithDownload> {
  const item = toRawWithDownload(row);
  if (row.status !== "ready" || !(await posterExists(row.outputKey))) return item;
  return { ...item, posterUrl: getSignedFileUrl(posterKeyFor(row.outputKey), env.RECORDING_URL_TTL_SEC) };
}

/** Записи школы для страницы администратора (первые `limit`, новые сверху) и их общее число. */
export async function listRawRecordingsForSchool(
  schoolId: string,
  limit: number,
): Promise<{ rows: RawRecordingRow[]; total: number }> {
  const [rows, total] = await Promise.all([
    rawRepo.listRawRecordingsForSchool(schoolId, limit),
    rawRepo.countRawRecordingsForSchool(schoolId),
  ]);
  return { rows, total };
}

export async function findRawRecordingForSchool(id: string, schoolId: string): Promise<RawRecordingRow | null> {
  const row = await rawRepo.findRawRecording(id);
  return row && row.schoolId === schoolId ? row : null;
}

export async function sumReadyRawSizeForSchool(schoolId: string): Promise<number> {
  return rawRepo.sumReadyRawSizeForSchool(schoolId);
}

/**
 * Удаление экспериментальной записи администратором: ролик, обложка и
 * исходные дорожки (в них медиа урока). Идущую или собираемую — нельзя.
 */
export async function deleteRawRecording(row: RawRecordingRow): Promise<void> {
  if (!["ready", "failed", "aborted"].includes(row.status)) {
    throw new AppError(409, "recording_active", "Запись ещё идёт или обрабатывается — удалить можно после окончания");
  }
  await deleteFile(row.outputKey);
  await removePoster(row.outputKey);
  await deleteTree(row.recordingDir);
  await rawRepo.markRawDeleted(row.id);
  await rawRepo.clearRawExpiry(row.id);
}

export async function getRawRecordingDetail(user: AccessTokenPayload, id: string): Promise<RawRecordingDetail> {
  if (user.role !== "admin") throw new AppError(403, "forbidden", "Доступно только администратору");
  const row = await rawRepo.findRawRecording(id);
  if (!row || row.schoolId !== user.schoolId) throw new AppError(404, "not_found", "Запись не найдена");
  return {
    id: row.id,
    lessonId: row.lessonId,
    status: row.status,
    attempt: row.attempt,
    renderAttempts: row.renderAttempts,
    renderStep: row.renderStep,
    lastError: row.lastError,
    compareRecordingId: row.compareRecordingId,
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    recorderStats: (row.recorderStats as RawRecorderStats | null) ?? null,
    renderMetrics: (row.renderMetrics as Record<string, number | string | boolean> | null) ?? null,
    journalEvents: await rawRepo.countJournalEvents(row.id),
    url: row.status === "ready" ? getSignedFileUrl(row.outputKey, env.RECORDING_URL_TTL_SEC) : null,
  };
}

/** Ручная пересборка (admin): `failed` с сохранёнными исходниками → снова в очередь рендера. */
export async function retryRawRender(user: AccessTokenPayload, id: string): Promise<RawRecordingDetail> {
  if (user.role !== "admin") throw new AppError(403, "forbidden", "Доступно только администратору");
  const row = await rawRepo.findRawRecording(id);
  if (!row || row.schoolId !== user.schoolId) throw new AppError(404, "not_found", "Запись не найдена");
  const updated = await rawRepo.updateRawRecordingIf(row.id, ["failed"], {
    status: "queued_for_render",
    lastError: null,
    rawExpiresAt: null,
    endedAt: null,
    renderAttempts: 0,
  });
  if (!updated) throw new AppError(409, "not_failed", "Пересобрать можно только запись в статусе failed");
  return getRawRecordingDetail(user, id);
}

// ─── Внутренний API: аутентификация ────────────────────────────────────────

/** Секрет внутреннего API, сравнение за постоянное время. `false` — метод выключен или секрет чужой. */
export function verifyInternalSecret(header: string | undefined): boolean {
  const secret = env.RAW_RECORDER_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ─── Внутренний API: рекордер ──────────────────────────────────────────────

/** LiveKit-токен рекордера: скрытый участник, только подписка, грант `recorder`. */
async function mintRecorderLivekitToken(row: RawRecordingRow): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    // Не uuid — вебхуки LiveKit по такому identity не трогают посещаемость
    // (`rooms/livekit-webhook.ts`, UUID_RE), как и у Egress («EG_…»).
    identity: `RR_${row.id.slice(0, 8)}_${row.attempt}`,
    name: "Запись (эксперимент)",
    ttl: env.RAW_RECORDING_MAX_DURATION_SEC + 3600,
  });
  at.addGrant({
    room: row.livekitRoom,
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    hidden: true,
    recorder: true,
  });
  return at.toJwt();
}

export async function claimRecordJob(workerId: string): Promise<RawRecordJob | null> {
  const leaseId = randomUUID();
  const row = await rawRepo.claimRecordJob(workerId, leaseId);
  if (!row) return null;
  logEvent("raw_recording_claimed", { recordingId: row.id, lessonId: row.lessonId, attempt: row.attempt, workerId });
  return {
    recordingId: row.id,
    lessonId: row.lessonId,
    attempt: row.attempt,
    leaseId,
    livekitUrl: env.RAW_RECORDER_LIVEKIT_URL ?? env.LIVEKIT_URL,
    livekitToken: await mintRecorderLivekitToken(row),
    attemptDir: path.posix.join(row.recordingDir, `attempt-${row.attempt}`),
    maxDurationSec: Math.max(60, env.RAW_RECORDING_MAX_DURATION_SEC - Math.floor((Date.now() - row.startedAt.getTime()) / 1000)),
    // Камеры в кадре — плитки ленты/сетки: среднего слоя simulcast (~360p)
    // хватает и он в 3–4 раза дешевле по сети; демонстрация — крупно, высокий.
    cameraQuality: "medium",
    screenQuality: "high",
    heartbeatIntervalSec: RECORDER_HEARTBEAT_SEC,
  };
}

export async function recorderHeartbeat(
  id: string,
  leaseId: string,
  stats: RawRecorderStats,
): Promise<{ stop: boolean }> {
  const row = await rawRepo.touchRecorderLease(id, leaseId, stats);
  if (!row) throw new AppError(409, "lease_lost", "Задание записи передано другому рекордеру или завершено");
  return { stop: row.stopRequestedAt != null || row.status === "finalizing" };
}

export async function recorderFinished(
  id: string,
  leaseId: string,
  input: { reason: string; error: string | null; stats: RawRecorderStats },
): Promise<void> {
  const row = await rawRepo.finishRecorderLease(id, leaseId, {
    stats: input.stats,
    lastError: input.error ? `recorder: ${input.error}` : null,
  });
  if (!row) throw new AppError(409, "lease_lost", "Задание записи передано другому рекордеру или завершено");
  await journal.closeJournalForRecording(id).catch(() => undefined);
  logEvent("raw_recording_recorded", { recordingId: id, reason: input.reason, ...input.stats });
  // Рекордер вышел сам (комната закрылась, предел длительности) — баннер снять.
  roomsService.broadcastToLesson(row.lessonId, { type: "recording_status", active: false });
}

/** Воркер стартовал: вернуть задания его прежнего процесса (см. raw-repo#recoverWorkerLeases). */
export async function recoverWorker(workerId: string): Promise<{ recovered: number }> {
  const rows = await rawRepo.recoverWorkerLeases(workerId);
  for (const row of rows) {
    logger().warn({ recordingId: row.id, status: row.status, workerId }, "raw worker restarted: lease recovered");
  }
  return { recovered: rows.length };
}

// ─── Внутренний API: рендер ────────────────────────────────────────────────

export async function claimRenderJob(workerId: string): Promise<RawRenderJob | null> {
  const leaseId = randomUUID();
  const row = await rawRepo.claimRenderJob(workerId, leaseId, MAX_RENDER_ATTEMPTS);
  if (!row) return null;
  const settings = await schoolSettingsService.getSchoolSettings(row.schoolId);
  const size = RENDER_SIZE[settings.recordingResolution] ?? RENDER_SIZE["720p"]!;
  const token = await signRecorderToken(row.lessonId, row.id);
  const origin = env.RAW_RENDER_REPLAY_ORIGIN ?? env.PUBLIC_ORIGIN;
  const replayUrl = new URL("/recording-replay", origin);
  replayUrl.searchParams.set("rid", row.id);
  replayUrl.searchParams.set("token", token);
  logEvent("raw_render_claimed", { recordingId: row.id, attempt: row.renderAttempts, workerId });
  return {
    recordingId: row.id,
    lessonId: row.lessonId,
    leaseId,
    attempt: row.renderAttempts,
    recordingDir: row.recordingDir,
    outputKey: row.outputKey,
    t0Ms: row.startedAt.getTime(),
    t1Ms: (row.stoppedAt ?? new Date()).getTime(),
    replayUrl: replayUrl.toString(),
    width: size.width,
    height: size.height,
    fps: settings.recordingFps,
    videoBitrateKbps: settings.recordingBitrateKbps,
  };
}

const RENDER_SIZE: Record<string, { width: number; height: number }> = {
  "360p": { width: 640, height: 360 },
  "480p": { width: 960, height: 540 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

export async function renderHeartbeat(id: string, leaseId: string, step: string): Promise<void> {
  const row = await rawRepo.touchRenderLease(id, leaseId, step);
  if (!row) throw new AppError(409, "lease_lost", "Задание рендера передано другому или завершено");
}

/**
 * Рендер собрал и проверил MP4 и атомарно переименовал его в `outputKey`.
 * Ставим `ready`, только убедившись сами, что файл на месте и размер тот,
 * о котором отчитался рендер — иначе это ошибка сборки (повтор).
 */
export async function renderFinished(
  id: string,
  leaseId: string,
  input: { durationSec: number; sizeBytes: number; metrics: Record<string, number | string | boolean> },
): Promise<void> {
  const row = await rawRepo.findByRenderLease(id, leaseId);
  if (!row) throw new AppError(409, "lease_lost", "Задание рендера передано другому или завершено");
  const file = await statFile(row.outputKey);
  if (!file || file.sizeBytes !== input.sizeBytes || input.durationSec <= 0) {
    await renderFailed(id, leaseId, {
      error: `published file check failed: ${file ? `size ${file.sizeBytes} != ${input.sizeBytes}` : "file missing"}`,
      retryable: true,
    });
    return;
  }
  const now = new Date();
  const updated = await rawRepo.completeRenderLease(id, leaseId, {
    status: "ready",
    durationSec: input.durationSec,
    sizeBytes: input.sizeBytes,
    renderMetrics: input.metrics,
    renderStep: "done",
    lastError: null,
    endedAt: now,
    expiresAt: await recordingExpiresAt(row.schoolId, now),
    rawExpiresAt: new Date(now.getTime() + env.RAW_RECORDING_SOURCE_RETENTION_HOURS * 3600_000),
  });
  if (!updated) throw new AppError(409, "lease_lost", "Задание рендера передано другому или завершено");
  logEvent("raw_recording_ready", { recordingId: id, durationSec: input.durationSec, sizeBytes: input.sizeBytes });
  void enqueuePoster(row.outputKey, Math.round(input.durationSec));
}

export async function renderFailed(
  id: string,
  leaseId: string,
  input: { error: string; retryable: boolean },
): Promise<void> {
  const row = await rawRepo.findByRenderLease(id, leaseId);
  if (!row) throw new AppError(409, "lease_lost", "Задание рендера передано другому или завершено");
  const giveUp = !input.retryable || row.renderAttempts >= MAX_RENDER_ATTEMPTS;
  const now = new Date();
  await rawRepo.completeRenderLease(
    id,
    leaseId,
    giveUp
      ? {
          status: "failed",
          lastError: input.error,
          endedAt: now,
          rawExpiresAt: new Date(now.getTime() + FAILED_SOURCE_RETENTION_MS),
        }
      : { status: "queued_for_render", lastError: input.error },
  );
  logger().warn({ recordingId: id, attempt: row.renderAttempts, giveUp, error: input.error }, "raw render failed");
}

export async function getJournalPage(id: string, afterSeq: number, limit: number): Promise<JournalPage> {
  const rows = await rawRepo.listJournalPage(id, afterSeq, limit);
  const events = rows.map(toJournalEvent);
  return { events, nextAfterSeq: rows.length === limit ? rows[rows.length - 1]!.seq : null };
}

function toJournalEvent(row: rawRepo.JournalRow): JournalEvent {
  return {
    seq: row.seq,
    tsMs: row.tsMs,
    kind: row.kind as JournalEvent["kind"],
    payload: row.payload ?? null,
    data: row.data ? row.data.toString("base64") : null,
  };
}

/** Виды событий, нужные странице кадров доски/задания (`/recording-replay`). */
const REPLAY_KINDS = ["lesson_snapshot", "room_event", "yjs_snapshot", "yjs_update", "viewport", "activity_view", "journal_started"];
const REPLAY_PAGE = 5000;

/**
 * Журнал для страницы кадров. Доступ — recorder-токен, выписанный рендеру
 * на ЭТУ запись (`recordingId` в токене = id записи, урок совпадает).
 */
export async function getReplayData(recorder: RecorderTokenPayload, id: string): Promise<RawReplayData> {
  const row = await rawRepo.findRawRecording(id);
  if (!row || recorder.recordingId !== id || recorder.lessonId !== row.lessonId) {
    throw new AppError(404, "not_found", "Запись не найдена");
  }
  const events: JournalEvent[] = [];
  let afterSeq = 0;
  for (;;) {
    const rows = await rawRepo.listJournalPage(id, afterSeq, REPLAY_PAGE, REPLAY_KINDS);
    events.push(...rows.map(toJournalEvent));
    if (rows.length < REPLAY_PAGE) break;
    afterSeq = rows[rows.length - 1]!.seq;
  }
  return {
    recordingId: row.id,
    lessonId: row.lessonId,
    followUserId: row.startedBy,
    t0Ms: row.startedAt.getTime(),
    t1Ms: (row.stoppedAt ?? new Date()).getTime(),
    events,
  };
}

/** Метрики очереди (Prometheus, plugins/metrics.ts). Метод выключен — пусто. */
export async function getRawQueueSnapshot(): Promise<Awaited<ReturnType<typeof rawRepo.queueSnapshot>> | null> {
  if (!experimentalRecordingEnabled()) return null;
  return rawRepo.queueSnapshot();
}

// ─── Сверка и ретеншн ──────────────────────────────────────────────────────

/**
 * Один проход сверки: пропавшие рекордеры и рендеры, стоп без рекордера,
 * записи дольше предела. Всё — условными UPDATE, повторный проход безвреден.
 */
export async function runRawSweepOnce(now = new Date()): Promise<void> {
  const recorderStale = await rawRepo.expireRecorderLeases(new Date(now.getTime() - RECORDER_LEASE_TTL_MS));
  for (const row of recorderStale) {
    logger().warn({ recordingId: row.id, status: row.status, attempt: row.attempt }, "raw recorder lease expired");
  }
  const settled = await rawRepo.settleStoppedUnclaimed();
  for (const row of settled) {
    logger().info({ recordingId: row.id, status: row.status }, "raw recording settled after stop");
  }
  const renderStale = await rawRepo.expireRenderLeases(new Date(now.getTime() - RENDER_LEASE_TTL_MS), MAX_RENDER_ATTEMPTS);
  for (const row of renderStale) {
    logger().warn({ recordingId: row.id, status: row.status, attempt: row.renderAttempts }, "raw render lease expired");
  }
  // Предел длительности: рекордер сам выходит по `maxDurationSec`, а
  // `requested` без рекордера иначе висела бы и держала журнал вечно.
  const limitMs = env.RAW_RECORDING_MAX_DURATION_SEC * 1000;
  for (const row of await rawRepo.listActiveRawRecordings()) {
    if (now.getTime() - row.startedAt.getTime() > limitMs) await requestRawStop(row);
  }
}

export async function runRawRetentionOnce(): Promise<void> {
  for (const row of await rawRepo.listRawSourcesToPurge()) {
    try {
      await deleteTree(row.recordingDir);
      await rawRepo.clearRawExpiry(row.id);
      logger().info({ recordingId: row.id }, "raw recording sources purged");
    } catch (err) {
      logTaskFailure("recordings.raw_purge", err, { recordingId: row.id });
    }
  }
  for (const row of await rawRepo.listExpiredRawOutputs()) {
    try {
      await deleteFile(row.outputKey);
      await removePoster(row.outputKey);
      await rawRepo.markRawDeleted(row.id);
    } catch (err) {
      logTaskFailure("recordings.raw_retention", err, { recordingId: row.id });
    }
  }
}

const RAW_SWEEP_INTERVAL_MS = 10_000;
const RAW_RETENTION_INTERVAL_MS = 60 * 60_000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let retentionTimer: ReturnType<typeof setInterval> | null = null;

/** Запуск фоновых задач метода. Без секрета ничего не запускается. */
export function startRawRecordingBackground(): void {
  if (!experimentalRecordingEnabled() || sweepTimer) return;
  void journal.startJournal();
  sweepTimer = setInterval(() => {
    void runRawSweepOnce().catch((err: unknown) => logTaskFailure("recordings.raw_sweep", err));
  }, RAW_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  retentionTimer = setInterval(() => {
    void runRawRetentionOnce().catch((err: unknown) => logTaskFailure("recordings.raw_retention_sweep", err));
  }, RAW_RETENTION_INTERVAL_MS);
  retentionTimer.unref?.();
}

export async function stopRawRecordingBackground(): Promise<void> {
  if (sweepTimer) clearInterval(sweepTimer);
  if (retentionTimer) clearInterval(retentionTimer);
  sweepTimer = null;
  retentionTimer = null;
  await journal.stopJournal();
}

export { journalLivekitEvent } from "./journal.js";
