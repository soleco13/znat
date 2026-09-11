import { z } from "zod";

/**
 * Пометки учителя поверх материала конкретного ученика на уроке.
 * Одностороннее «учитель рисует — ученик видит»: это НЕ совместный холст
 * (в отличие от доски урока, `canvas.ts`), поэтому и не через Yjs, а
 * обычным JSON с автосейвом + опросом на стороне ученика.
 *
 * Система координат:
 *  - `x` — в пикселях контента на момент рисования, `w` — ширина колонки
 *    тогда; при отрисовке масштабируется на `текущая ширина / w`;
 *  - `y` — ОТНОСИТЕЛЬНО ВЕРХА блока `anchor` (id блока материала, над
 *    которым начался штрих). У учителя и ученика один и тот же материал
 *    рендерится РАЗНОЙ вёрсткой (у учителя — ответы ученика и ключи, у
 *    ученика — живые поля и «Сдать»), поэтому абсолютный Y разъезжается на
 *    десятки пикселей. Привязка к блоку держит пометку у своего абзаца.
 *  - `anchor` пустой (старые штрихи / блок не найден при отрисовке) → `y`
 *    трактуется как абсолютный от верха контента (прежнее поведение).
 */

/** Инструменты: перо (непрозрачное), маркер (толще, полупрозрачный). */
export const annotationToolSchema = z.enum(["pen", "marker"]);
export type AnnotationTool = z.infer<typeof annotationToolSchema>;

/** Фиксированная палитра — чтобы в jsonb не попадал произвольный ввод. */
export const ANNOTATION_COLORS = ["#e5484d", "#0090ff", "#30a46c", "#f5d90a"] as const;
export const annotationColorSchema = z.enum(ANNOTATION_COLORS);
export type AnnotationColor = z.infer<typeof annotationColorSchema>;

/** Перф-ограничители (аналог лимита 500 элементов на странице доски, §3.4 ТЗ). */
export const ANNOTATION_MAX_STROKES = 400;
export const ANNOTATION_MAX_POINTS_PER_STROKE = 4000;

export const annotationStrokeSchema = z.object({
  id: z.string().min(1).max(64),
  tool: annotationToolSchema,
  color: annotationColorSchema,
  /** Толщина линии в px контента на момент рисования. */
  size: z.number().positive().max(80),
  /** Ширина колонки материала на момент рисования (px) — база для масштабирования. */
  w: z.number().positive().max(20000),
  /** id блока материала, к верху которого привязаны Y-координаты (`""` — абсолютно от верха контента). */
  anchor: z.string().max(64).default(""),
  /** Плоский список координат [x0,y0,x1,y1,…]: x в px контента, y — от верха блока `anchor`. */
  pts: z.array(z.number().finite()).min(2).max(ANNOTATION_MAX_POINTS_PER_STROKE * 2),
});
export type AnnotationStroke = z.infer<typeof annotationStrokeSchema>;

export const materialAnnotationsSchema = z.object({
  strokes: z.array(annotationStrokeSchema).max(ANNOTATION_MAX_STROKES),
});
export type MaterialAnnotations = z.infer<typeof materialAnnotationsSchema>;

/** Тело `PUT /activities/:id/participants/:participantId/annotations` (учитель). */
export const saveAnnotationsRequestSchema = materialAnnotationsSchema;
export type SaveAnnotationsRequest = z.infer<typeof saveAnnotationsRequestSchema>;

/** Ответ `GET …/annotations` и `GET /activities/:id/my-annotations`. */
export interface MaterialAnnotationsResponse {
  strokes: AnnotationStroke[];
  /** ISO-момент последней правки, `null` — пометок ещё нет. */
  updatedAt: string | null;
}
