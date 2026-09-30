import { Readable } from "node:stream";
import sharp from "sharp";
import { canvasImageMimeTypeSchema, type CanvasImageUploadResponse } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as storageService from "../storage/service.js";

const MAX_DIMENSION = 2000;

/**
 * `y-excalidraw` синхронизирует `BinaryFileData.dataURL` в `Y.Doc` как есть,
 * без собственного хука обновления (проверено чтением исходника пакета —
 * `_remoteFilesChangeHandler` просто перекладывает `yAssets.get(key)` в
 * `api.addFiles` на каждом клиенте). Раз ссылка на изображение доски один
 * раз попадает в бинарное состояние Y.Doc и живёт там неограниченно (пока
 * жив урок), обычный часовой TTL generic `/assets` (storage/service.ts,
 * рассчитан на одноразовые скачивания) сломал бы фото на доске уже в
 * процессе того же урока. Собственный механизм переподписи URL поверх
 * поведения чужой библиотеки не строим (пришлось бы дублировать логику
 * `y-excalidraw#observe` — фрагильно и не по разделу «делегируй смело»
 * CLAUDE.md); вместо этого используем длинный TTL: доска сейчас видна
 * только во время активного урока (RoomPage), реальный профиль
 * использования укладывается в него с большим запасом.
 */
const CANVAS_IMAGE_URL_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 дней

/**
 * Ресайз + сохранение изображения на доску (Э3.10, §3.3 ТЗ: «ресайз до
 * 2000px на сервере»). `.rotate()` без аргумента — авто-поворот по EXIF
 * `Orientation` с последующим удалением тега (поведение подтверждено
 * документацией sharp через Context7, не по памяти модели): без него фото,
 * снятое телефоном в портретной ориентации, легло бы на бок — EXIF-тег
 * камера пишет, а не переворачивает пиксели сама. `fit: "inside"` +
 * `withoutEnlargement: true` — ровно официальная замена sharp для
 * устаревшего `max().withoutEnlargement()`: не длиннее 2000px по большей
 * стороне, никогда не растягивает изображение меньше исходного.
 */
export async function uploadCanvasImage(input: {
  buffer: Buffer;
  mimeType: string;
  schoolId: string;
}): Promise<CanvasImageUploadResponse> {
  const parsedMime = canvasImageMimeTypeSchema.safeParse(input.mimeType);
  if (!parsedMime.success) {
    throw new AppError(400, "unsupported_type", "Поддерживаются только PNG, JPEG, WebP");
  }

  // Всегда WebP q90: визуально как исходник, но в 3–13 раз легче PNG
  // (замер на картинках доски: 2,7 МБ → 213 КБ, 364 КБ → 130 КБ). Полный PNG
  // на мобильной сети с потерями грузился у ученика десятки секунд.
  const resized = await sharp(input.buffer)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  const { storageKey } = await storageService.uploadFile({
    stream: Readable.from(resized.data),
    suggestedName: "board.webp",
    schoolId: input.schoolId,
  });

  return {
    storageKey,
    url: storageService.getSignedFileUrl(storageKey, CANVAS_IMAGE_URL_TTL_SECONDS),
    mimeType: "image/webp",
    width: resized.info.width,
    height: resized.info.height,
  };
}
