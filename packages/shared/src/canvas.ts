import { z } from "zod";

/**
 * Форматы изображений, принимаемые загрузкой на доску (Э3.10, §3.3 ТЗ).
 * SVG сознательно не входит — растровый ресайз до 2000px (sharp) не
 * применим к векторному формату так же, как к растру.
 */
export const canvasImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export type CanvasImageMimeType = z.infer<typeof canvasImageMimeTypeSchema>;

/** Потолок размера картинки на доску. Грузит любой участник с правом рисовать,
 *  а сервер держит файл в памяти на время ресайза — лимит жёсткий. */
export const CANVAS_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const canvasImageUploadResponseSchema = z.object({
  storageKey: z.string(),
  url: z.string(),
  mimeType: canvasImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CanvasImageUploadResponse = z.infer<typeof canvasImageUploadResponseSchema>;
