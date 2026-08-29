import { z } from "zod";

/**
 * Презентации урока (Э4, §3.5/§9 ТЗ). Пайплайн: загруженный .pptx/.docx/.odp/.pdf
 * → (ClamAV) → LibreOffice → PDF → pdftoppm → PNG@2x + превью → StorageAdapter,
 * затем слайды импортируются как страницы холста (Э4.6).
 *
 * В проекте нет таблицы `assets` — файлы адресуются `storageKey` + HMAC-URL
 * (как в Э0.5/Э3.10), поэтому здесь `*StorageKey`, а не `*AssetId` из §9.
 */

/** pending — в очереди; converting — воркер работает; ready — готово; failed — ошибка. */
export const deckStatusSchema = z.enum(["pending", "converting", "ready", "failed"]);
export type DeckStatus = z.infer<typeof deckStatusSchema>;

/** Форматы, принимаемые загрузкой презентации. PDF идёт мимо LibreOffice (Э4.7). */
export const deckSourceMimeTypeSchema = z.enum([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.oasis.opendocument.presentation", // .odp
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/pdf", // .pdf
]);
export type DeckSourceMimeType = z.infer<typeof deckSourceMimeTypeSchema>;

/** Один слайд готовой презентации. */
export const deckSlideSchema = z.object({
  index: z.number().int().nonnegative(),
  imageUrl: z.string(),
  thumbUrl: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type DeckSlide = z.infer<typeof deckSlideSchema>;

/** Презентация в ответах API (учителю/ученикам урока). */
export const deckSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  title: z.string(),
  status: deckStatusSchema,
  slideCount: z.number().int().nonnegative(),
  /** Сколько слайдов уже отрендерено (Э4.4, «7 из 24»). */
  progress: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string(),
  slides: z.array(deckSlideSchema),
});
export type Deck = z.infer<typeof deckSchema>;

/** Ответ на `POST /lessons/:id/uploads` (§8.1 ТЗ). */
export const deckUploadResponseSchema = z.object({
  deckId: z.string().uuid(),
  /** id задачи в очереди для опроса `GET /jobs/:jobId`. null — если презентация
   *  уже была сконвертирована ранее (дедуп по sha256, Э4.5) и готова сразу. */
  jobId: z.string().nullable(),
  status: deckStatusSchema,
});
export type DeckUploadResponse = z.infer<typeof deckUploadResponseSchema>;

// ─── Контракт очереди конвертации (Э4.3) ──────────────────────────────────
// Общий между producer (apps/api) и worker (services/converter). Воркер БД не
// видит (convnet — только redis + том /data/assets), поэтому передаём в задаче
// всё нужное строками, а результат он возвращает как значение задачи; в
// apps/api слушатель QueueEvents кладёт его в decks/deck_slides и шлёт WS-прогресс.

export const CONVERT_QUEUE_NAME = "deck-convert";

export const convertJobDataSchema = z.object({
  deckId: z.string().uuid(),
  schoolId: z.string().uuid(),
  /** Ключ исходного файла в StorageAdapter (внутри общего тома /data/assets). */
  sourceStorageKey: z.string().min(1),
  sourceMimeType: deckSourceMimeTypeSchema,
});
export type ConvertJobData = z.infer<typeof convertJobDataSchema>;

/** Один отрендеренный слайд в результате задачи. */
export const convertedSlideSchema = z.object({
  index: z.number().int().nonnegative(),
  imageStorageKey: z.string().min(1),
  thumbStorageKey: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Текстовый слой из `pdftotext -bbox` (Э4.8). Пусто, пока Э4.8 не сделан. */
  textLayer: z
    .array(
      z.object({
        text: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    )
    .nullable(),
});
export type ConvertedSlide = z.infer<typeof convertedSlideSchema>;

export const convertJobResultSchema = z.object({
  slideCount: z.number().int().positive(),
  slides: z.array(convertedSlideSchema),
});
export type ConvertJobResult = z.infer<typeof convertJobResultSchema>;

/** Прогресс задачи (`job.updateProgress`) — «отрендерено N из total». */
export const convertJobProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type ConvertJobProgress = z.infer<typeof convertJobProgressSchema>;

// ─── Событие прогресса в WS-канал урока (Э4.4) ────────────────────────────
// Идёт не в очередь, а в `/ws` (`ServerRoomMessage`, packages/shared/rooms.ts):
// лёгкая проекция строки `decks`, чтобы учитель видел «7 из 24», смену
// статуса и текст ошибки без отдельного запроса за списком презентаций.

export const deckProgressEventSchema = z.object({
  deckId: z.string().uuid(),
  title: z.string(),
  status: deckStatusSchema,
  /** Отрендерено слайдов («7» из «24» — второе число это slideCount). */
  progress: z.number().int().nonnegative(),
  slideCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type DeckProgressEvent = z.infer<typeof deckProgressEventSchema>;
