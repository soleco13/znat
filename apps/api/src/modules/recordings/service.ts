import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AccessTokenPayload } from "@school/shared";
import {
  ACTIVE_RECORDING_STATUSES,
  type LessonRecordingsResponse,
  type RecordingStatus,
  type RecordingSummary,
  type RecordingWithDownload,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { env } from "../../plugins/env.js";
import * as lessonsService from "../lessons/service.js";
import { getSignedFileUrl, deleteFile } from "../storage/service.js";
import type { EgressInfo } from "livekit-server-sdk";
import * as egress from "./egress-client.js";
import * as repo from "./repo.js";
import type { RecordingRow } from "./repo.js";

/**
 * Э10 — запись уроков (§10.4 ТЗ). Оркестрация: кто может нажать «Запись»,
 * куда пишется файл, как статус едет от egress-вебхука к строке в БД, как
 * файл удаляется по ретеншну.
 *
 * Egress живёт на второй машине; здесь только команды через LiveKit и
 * учёт. Никакого состояния записи в памяти процесса (CLAUDE.md) — всё в
 * таблице `recordings`.
 */

const NANOS_PER_SEC = 1_000_000_000;

/** Абсолютный путь для egress по нашему ключу хранилища. */
function absoluteFilepath(storageKey: string): string {
  return path.posix.join(env.STORAGE_ROOT, storageKey);
}

function toSummary(row: RecordingRow): RecordingSummary {
  return {
    id: row.id,
    lessonId: row.lessonId,
    status: row.status,
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Готовые записи скачиваются только по presigned-ссылке с TTL 1 час
 * (§10.10 ТЗ). Ссылка появляется только для `ready` — у остальных файла
 * ещё/уже нет.
 */
function toWithDownload(row: RecordingRow): RecordingWithDownload {
  const base = toSummary(row);
  if (row.status !== "ready" || !row.storageKey) {
    return { ...base, url: null, urlExpiresAt: null };
  }
  const url = getSignedFileUrl(row.storageKey, env.RECORDING_URL_TTL_SEC);
  const urlExpiresAt = new Date(Date.now() + env.RECORDING_URL_TTL_SEC * 1000).toISOString();
  return { ...base, url, urlExpiresAt };
}

/**
 * Право работать с записями урока. Ученику — нет вообще (§10.10 ТЗ:
 * «ученикам — нет»). Учитель — только свой урок. admin/methodist — любой.
 */
async function assertRecordingAccess(
  user: AccessTokenPayload,
  lessonId: string,
): Promise<void> {
  if (user.role === "student") {
    throw new AppError(403, "forbidden", "Записи уроков ученикам недоступны");
  }
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);
  if (user.role === "teacher" && lesson.teacherId !== user.sub) {
    // Тот же приём, что в materials (Э9.1): чужой урок — 404, не 403.
    throw new AppError(404, "not_found", "Урок не найден");
  }
}

/**
 * Э10.3 — старт записи. Только по явному действию учителя/админа, никогда
 * автоматически (стоп-лист Э10). Идемпотентности «одна активная запись на
 * урок» достаточно, чтобы двойной клик не поднял два egress.
 */
export async function startLessonRecording(
  user: AccessTokenPayload,
  lessonId: string,
): Promise<RecordingSummary> {
  if (!env.RECORDING_ENABLED) {
    throw new AppError(503, "recording_disabled", "Запись уроков пока недоступна");
  }
  if (user.role !== "teacher" && user.role !== "admin") {
    throw new AppError(403, "forbidden", "Начать запись может только учитель урока или администратор");
  }
  await assertRecordingAccess(user, lessonId);

  const existing = await repo.findActiveRecordingForLesson(lessonId, user.schoolId);
  if (existing) return toSummary(existing);

  const livekitRoom = await lessonsService.ensureLivekitRoom(user.schoolId, lessonId);

  const id = randomUUID();
  const storageKey = `recordings/${user.schoolId}/${lessonId}/${id}.mp4`;

  let started: egress.StartedRecording;
  try {
    started = await egress.startRoomRecording({
      roomName: livekitRoom,
      storageKey,
      absoluteFilepath: absoluteFilepath(storageKey),
    });
  } catch {
    throw new AppError(502, "egress_unavailable", "Сервис записи не ответил, попробуйте ещё раз");
  }

  const row = await repo.insertRecording({
    id,
    schoolId: user.schoolId,
    lessonId,
    startedBy: user.sub,
    egressId: started.egressId,
    status: started.status,
    storageKey,
  });
  return toSummary(row);
}

/** Э10.3 — стоп записи. Файл финализируется асинхронно, статус едет через вебхук. */
export async function stopLessonRecording(
  user: AccessTokenPayload,
  lessonId: string,
  recordingId: string,
): Promise<RecordingSummary> {
  if (user.role !== "teacher" && user.role !== "admin") {
    throw new AppError(403, "forbidden", "Остановить запись может только учитель урока или администратор");
  }
  await assertRecordingAccess(user, lessonId);

  const row = await repo.findRecordingById(recordingId, user.schoolId);
  if (!row || row.lessonId !== lessonId) {
    throw new AppError(404, "not_found", "Запись не найдена");
  }
  if (!ACTIVE_RECORDING_STATUSES.includes(row.status)) {
    return toSummary(row);
  }

  let status: RecordingStatus;
  try {
    status = await egress.stopRecording(row.egressId);
  } catch {
    throw new AppError(502, "egress_unavailable", "Сервис записи не ответил, попробуйте ещё раз");
  }
  const updated = await repo.updateRecording(row.id, {
    status: status === "recording" || status === "starting" ? "processing" : status,
  });
  return toSummary(updated ?? row);
}

export async function getLessonRecordings(
  user: AccessTokenPayload,
  lessonId: string,
): Promise<LessonRecordingsResponse> {
  await assertRecordingAccess(user, lessonId);
  const rows = await repo.listRecordingsForLesson(lessonId, user.schoolId);
  const active = rows.find((r) => ACTIVE_RECORDING_STATUSES.includes(r.status)) ?? null;
  return {
    active: active ? toSummary(active) : null,
    recordings: rows.map(toWithDownload),
  };
}

/**
 * Применить событие egress-вебхука (`egress_started`/`egress_updated`/
 * `egress_ended`). Идёт из rooms/livekit-webhook.ts. Подлинность уже
 * подтверждена подписью вебхука; здесь только маппинг в строку записи.
 */
export async function applyEgressEvent(input: {
  egressId: string;
  status: RecordingStatus;
  /** Из `fileResults[0]` в `egress_ended`. */
  fileSizeBytes?: number | null;
  fileDurationNanos?: bigint | number | null;
  endedAtEpochMs?: number | null;
}): Promise<void> {
  const row = await repo.findRecordingByEgressId(input.egressId);
  if (!row) return; // не наша запись или строка ещё не создана — пропускаем

  // Терминальный статус не откатываем более ранним (вебхуки могут прийти
  // не по порядку).
  if (isTerminal(row.status) && !isTerminal(input.status)) return;

  const patch: repo.RecordingUpdate = { status: input.status };

  if (input.status === "ready") {
    const durationSec =
      input.fileDurationNanos != null
        ? Math.round(Number(input.fileDurationNanos) / NANOS_PER_SEC)
        : row.durationSec;
    const endedAt = input.endedAtEpochMs ? new Date(input.endedAtEpochMs) : new Date();
    patch.durationSec = durationSec ?? null;
    patch.sizeBytes = input.fileSizeBytes ?? row.sizeBytes;
    patch.endedAt = endedAt;
    patch.expiresAt = new Date(endedAt.getTime() + env.RECORDING_RETENTION_DAYS * 86_400_000);
  } else if (isTerminal(input.status)) {
    patch.endedAt = input.endedAtEpochMs ? new Date(input.endedAtEpochMs) : new Date();
  }

  await repo.updateRecording(row.id, patch);
}

/**
 * Обёртка над `applyEgressEvent` для сырого `EgressInfo` из вебхука
 * (rooms/livekit-webhook.ts). Держит распаковку protobuf-полей egress в
 * одном месте — модуль `rooms` не знает про формат egress.
 */
export async function applyEgressWebhook(info: EgressInfo): Promise<void> {
  const file = info.fileResults?.[0];
  await applyEgressEvent({
    egressId: info.egressId,
    status: egress.mapEgressStatus(info.status),
    fileSizeBytes: file?.size != null ? Number(file.size) : null,
    fileDurationNanos: file?.duration != null ? BigInt(file.duration) : null,
    endedAtEpochMs: info.endedAt ? Number(info.endedAt) / 1_000_000 : null,
  });
}

function isTerminal(status: RecordingStatus): boolean {
  return status === "ready" || status === "failed" || status === "aborted" || status === "deleted";
}

/**
 * Реконсиляция «зависших» записей: строка ещё `starting`/`recording`/
 * `processing`, а egress уже давно завершил (вебхук потерялся при
 * рестарте API — тот же класс проблемы, что `startDeckReconcileSweep`).
 */
export async function reconcileRecording(row: RecordingRow): Promise<void> {
  const info = await egress.getEgressInfo(row.egressId);
  if (!info) {
    // Egress о такой записи не знает (истёк из его истории) — если она у
    // нас всё ещё «активна», считаем прерванной.
    if (ACTIVE_RECORDING_STATUSES.includes(row.status)) {
      await repo.updateRecording(row.id, { status: "aborted", endedAt: new Date() });
    }
    return;
  }
  const status = egress.mapEgressStatus(info.status);
  const file = info.fileResults?.[0];
  await applyEgressEvent({
    egressId: row.egressId,
    status,
    fileSizeBytes: file?.size != null ? Number(file.size) : null,
    fileDurationNanos: file?.duration != null ? BigInt(file.duration) : null,
    endedAtEpochMs: info.endedAt ? Number(info.endedAt) / 1_000_000 : null,
  });
}

/**
 * Э10.4 — автоудаление по ретеншну (§10.10 ТЗ). Файл убираем через
 * StorageAdapter, строку оставляем в статусе `deleted` для журнала.
 */
export async function runRetentionCleanup(): Promise<number> {
  const expired = await repo.listExpiredRecordings();
  let deleted = 0;
  for (const row of expired) {
    try {
      if (row.storageKey) await deleteFile(row.storageKey);
      await repo.updateRecording(row.id, { status: "deleted", sizeBytes: null });
      deleted += 1;
    } catch (err) {
      console.error("recordings: retention cleanup failed", row.id, err);
    }
  }
  return deleted;
}

// --- Свип ретеншна: тот же приём, что startDeckReconcileSweep (интервал,
//     unref, идемпотентный старт). Запускается из server.ts. ---
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // раз в час
let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startRecordingRetentionSweep(): void {
  if (retentionTimer) return;
  void runRetentionCleanup().catch((err: unknown) => {
    console.error("recordings: initial retention cleanup failed", err);
  });
  retentionTimer = setInterval(() => {
    void runRetentionCleanup().catch((err: unknown) => {
      console.error("recordings: retention sweep failed", err);
    });
  }, RETENTION_SWEEP_INTERVAL_MS);
  retentionTimer.unref?.();
}

export function stopRecordingRetentionSweep(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
