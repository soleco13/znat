import { Readable } from "node:stream";
import sharp from "sharp";
import {
  mediaAudioMimeTypeSchema,
  mediaImageMimeTypeSchema,
  type MediaAsset,
  type MediaAssetKind,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as storageService from "../storage/service.js";
import * as mediaRepo from "./media-repo.js";

const MAX_IMAGE_DIMENSION = 2000;

/**
 * Медиатека (Э9.7, §7.2 ТЗ: «загруженные картинки/аудио, с переиспользованием
 * между материалами»). `kind` определяется СЕРВЕРОМ по заявленному
 * `mimeType` файла (не принимается от клиента отдельным полем формы) — от
 * него зависит, в каком пикере (image/audio) файл потом появится, и
 * доверять клиентскому выбору здесь смысла нет, раз тип и так есть в самом
 * файле multipart-запроса.
 *
 * Изображения ресайзятся тем же приёмом, что уже применён к доске урока
 * (Э3.10, `canvas/images.ts`) — до `MAX_IMAGE_DIMENSION`, `.rotate()` без
 * аргумента разворачивает по EXIF `Orientation`. Код НЕ переиспользован
 * напрямую (`uploadCanvasImage`) — модуль `materials` не имеет права
 * дёргать внутренности `canvas` (CLAUDE.md, «модуль не импортирует
 * таблицы/логику чужого модуля напрямую»), плюс политика TTL подписанной
 * ссылки здесь другая (обычный часовой TTL `storageService`, не
 * специальный 30-дневный, что у доски). Аудио сохраняется как есть —
 * транскодирование не входит в эту подзадачу.
 */
export async function uploadMediaAsset(input: {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  schoolId: string;
  uploadedBy: string;
}): Promise<MediaAsset> {
  const asImage = mediaImageMimeTypeSchema.safeParse(input.mimeType);
  const asAudio = mediaAudioMimeTypeSchema.safeParse(input.mimeType);
  if (!asImage.success && !asAudio.success) {
    throw new AppError(
      400,
      "unsupported_type",
      "Поддерживаются изображения (PNG/JPEG/WebP) и аудио (MP3/WAV/OGG/M4A/WebM)",
    );
  }
  const kind: MediaAssetKind = asImage.success ? "image" : "audio";

  let buffer = input.buffer;
  if (kind === "image") {
    buffer = await sharp(input.buffer)
      .rotate()
      .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
      .toBuffer();
  }

  const { storageKey, sizeBytes } = await storageService.uploadFile({
    stream: Readable.from(buffer),
    suggestedName: input.originalName,
    schoolId: input.schoolId,
  });

  const row = await mediaRepo.insertMediaAsset({
    schoolId: input.schoolId,
    uploadedBy: input.uploadedBy,
    kind,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes,
    storageKey,
  });

  return toMediaAsset(row);
}

/** Видимость по роли (кто вообще может дойти до этого вызова) решает роут (`requireRole`, как и у остального `materials`) — здесь только сама выборка школы + опциональный фильтр по `kind`, без ограничения по загрузившему. */
export async function listMediaAssets(schoolId: string, kind?: MediaAssetKind): Promise<MediaAsset[]> {
  const rows = await mediaRepo.listMediaAssetRows(schoolId, kind);
  return rows.map(toMediaAsset);
}

/**
 * Резолв `assetId → подписанная ссылка` (§8 ТЗ: `GET /assets/:id/url`) —
 * НЕ под `requireRole` (в отличие от `POST`/`GET /materials/media` выше):
 * блоки `image`/`audio` внутри материала видит и ученик (через выдачу,
 * Э8.6), значит и ссылку на файл ученик должен уметь получить — доступ к
 * САМОМУ материалу уже проверен раньше в цепочке (`activities`), здесь
 * достаточно не отдать чужую школу. Отказ — 404 (тот же принцип, что и в
 * `getMaterialForEdit`: не подтверждаем факт существования чужого id).
 */
export async function getMediaAssetUrl(schoolId: string, assetId: string): Promise<string> {
  const row = await mediaRepo.findMediaAssetById(assetId);
  if (!row || row.schoolId !== schoolId) {
    throw new AppError(404, "media_asset_not_found", "Файл не найден");
  }
  return storageService.getSignedFileUrl(row.storageKey);
}

function toMediaAsset(row: mediaRepo.MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: storageService.getSignedFileUrl(row.storageKey),
    createdAt: row.createdAt.toISOString(),
  };
}
