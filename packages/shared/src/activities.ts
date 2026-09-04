import { z } from "zod";
import { questionResponseSchema, type PublicMaterial } from "./materials.js";

/**
 * Выдача материала классу/ученику (Э8.6, §6.5/§7.3/§8 ТЗ). «Активность» —
 * это конкретная выдача конкретной версии материала: тот же материал можно
 * запустить в разных уроках и как домашнюю работу, ответы разных выдач не
 * смешиваются (`activities`/`responses`, Э8.2).
 *
 * **Задание уходит каждому ученику индивидуально — не через доску/Y.Doc**
 * (§7.3 ТЗ дословно, DoD Э8.6: «ученик не видит ответы соседа»). Механика:
 * учитель зовёт `POST /lessons/:id/activities`, сервер шлёт в WS-канал урока
 * (`rooms`, НЕ Yjs) короткое `activity_started`, каждый клиент отдельным
 * HTTP-запросом забирает свою копию через `GET /activities/:id/my` — со
 * своим `attemptId`, своим порядком перемешанных вариантов и БЕЗ ключей
 * ответов (`stripMaterialAnswerKeys`, Э8.1).
 */

/** `lesson` — выдача во время урока; `homework` — домашняя работа вне урока (Э8.11). Совпадает с enum `activity_mode` в БД. */
export const activityModeSchema = z.enum(["lesson", "homework"]);
export type ActivityMode = z.infer<typeof activityModeSchema>;

/** Тело `POST /lessons/:id/activities` — учитель запускает материал для класса. */
export const createActivityRequestSchema = z.object({
  materialId: z.string().uuid(),
  mode: activityModeSchema.default("lesson"),
  /** ISO-момент дедлайна; после него приём ответов закрывается (Э8.7/8.10). */
  deadline: z.string().datetime({ offset: true }).optional(),
  /** Таймер на выполнение, секунды; отсчитывается у каждого ученика от старта его попытки. */
  timerSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
});
export type CreateActivityRequest = z.infer<typeof createActivityRequestSchema>;

/** Учительское представление выдачи (без содержимого материала — оно приходит ученику через `/my`). */
export interface ActivityDto {
  id: string;
  lessonId: string | null;
  materialId: string;
  materialVersion: number;
  mode: ActivityMode;
  deadline: string | null;
  timerSeconds: number | null;
  createdAt: string;
}

/** Один сохранённый ответ ученика в рамках его попытки (черновик до сабмита). */
export const savedResponseSchema = z.object({
  questionId: z.string().min(1),
  response: questionResponseSchema,
});
export type SavedResponse = z.infer<typeof savedResponseSchema>;

/**
 * Тело `POST /activities/:id/responses` (Э8.7) — автосохранение черновика
 * одного ответа. Клиент шлёт его раз в ~5 сек после изменения и при потере
 * фокуса/выгрузке вкладки; сервер делает upsert по `(attemptId, questionId)`.
 * `response.type` должен совпадать с типом взаимодействия этого вопроса —
 * сервер проверяет по закреплённой версии материала.
 */
export const saveResponseRequestSchema = z.object({
  questionId: z.string().min(1),
  response: questionResponseSchema,
  /** Накопленное время на вопросе, мс (для панели прогресса Э8.8). Сервер берёт максимум со снятым ранее. */
  timeSpentMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
});
export type SaveResponseRequest = z.infer<typeof saveResponseRequestSchema>;

export interface SaveResponseResult {
  saved: true;
  /** ISO-момент сохранения на сервере. */
  savedAt: string;
}

/**
 * Ответ `GET /activities/:id/my` — индивидуальная копия задания для одного
 * ученика. `material` уже прошёл `stripMaterialAnswerKeys` с сидом
 * `attemptId` — ключей ответов в нём нет, порядок вариантов свой на попытку.
 */
export interface MyActivity {
  activityId: string;
  attemptId: string;
  attemptNumber: number;
  mode: ActivityMode;
  deadline: string | null;
  timerSeconds: number | null;
  /** Момент старта ЭТОЙ попытки — точка отсчёта таймера. */
  startedAt: string;
  material: PublicMaterial;
  /** Ранее сохранённые черновики ответов этой попытки, по `questionId`. */
  savedResponses: Record<string, SavedResponse["response"]>;
}
