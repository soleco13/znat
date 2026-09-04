import { z } from "zod";
import {
  questionResponseSchema,
  type Material,
  type PublicMaterial,
  type QuestionResponse,
} from "./materials.js";

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

/**
 * Тело `POST /lessons/:id/activities` (выдача в уроке) и
 * `POST /groups/:id/activities` (домашняя работа, Э8.11) — оба эндпоинта
 * принимают одно и то же тело, `mode` в теле ИГНОРИРУЕТСЯ сервисом: сам
 * режим определяет URL, которым учитель воспользовался (см. докстринги
 * `createActivity`/`createHomeworkActivity` в activities/service.ts) —
 * поле оставлено в схеме только ради обратной совместимости формы, не как
 * реальный переключатель.
 */
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
  /** Группа, которой адресована выдача (Э8.11) — заполнено всегда, для обоих режимов (см. `activities.groupId` в схеме БД). */
  groupId: string;
  materialId: string;
  materialVersion: number;
  mode: ActivityMode;
  deadline: string | null;
  timerSeconds: number | null;
  createdAt: string;
  /** Момент старта разбора (Э8.10), либо `null` — разбор ещё не начат. */
  reviewedAt: string | null;
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

// ─── Панель прогресса класса (Э8.8, §7.3 ТЗ) ──────────────────────────────

/**
 * `not_started` — ученик не открывал задание и не отвечал; `in_progress` —
 * открыл/отвечает; `stuck` — открыл, но давно ничего не сохранял и ответил
 * не на все вопросы («застрял», §7.3 ТЗ).
 */
export type StudentProgressStatus = "not_started" | "in_progress" | "stuck";

export interface StudentProgress {
  userId: string;
  fullName: string;
  status: StudentProgressStatus;
  /** Сколько разных вопросов уже сохранено. */
  answered: number;
  /** Всего вопросов в материале. */
  total: number;
  /** ISO-момент последнего сохранения ответа, либо null. */
  lastActivityAt: string | null;
}

/** Ответ `GET /activities/:id/progress` — живая картина класса для учителя. */
export interface ActivityProgress {
  activityId: string;
  total: number;
  students: StudentProgress[];
}

// ─── Аналитика по вопросу (Э8.9, §7.3 ТЗ: «17 из 24 выбрали B») ────────────

/** Один столбец гистограммы: вариант ответа, сколько учеников его выбрало, верный ли он. */
export interface AnalyticsBar {
  /** id варианта / значение пропуска / текст ответа. */
  key: string;
  label: string;
  count: number;
  /** true/false для автопроверяемых, null — если верность к этому столбцу неприменима. */
  correct: boolean | null;
}

/** Распределение по вариантам — `single_choice`, `multiple_choice`, `true_false`. */
export interface ChoiceDistribution {
  kind: "choice";
  bars: AnalyticsBar[];
}

/** Свободный ввод — `text_input`, `numeric_input`, `open_answer`: топ различных ответов. */
export interface TextDistribution {
  kind: "text";
  bars: AnalyticsBar[];
  /** Сколько различных ответов не поместилось в топ. */
  otherDistinct: number;
}

/** По пропускам — `cloze_dropdown`, `cloze_text`. */
export interface GapsDistribution {
  kind: "gaps";
  gaps: { gapId: string; bars: AnalyticsBar[] }[];
}

/** `matching`, `ordering` — только сводка «верно / неверно», гистограммы вариантов нет. */
export interface SummaryDistribution {
  kind: "summary";
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
}

export type QuestionDistribution =
  | ChoiceDistribution
  | TextDistribution
  | GapsDistribution
  | SummaryDistribution;

export interface QuestionAnalytics {
  questionId: string;
  promptHtml: string;
  interactionType: string;
  totalAnswered: number;
  distribution: QuestionDistribution;
}

/** Ответ `GET /activities/:id/analytics` — по одному разбору на вопрос материала. */
export interface ActivityAnalytics {
  activityId: string;
  respondents: number;
  questions: QuestionAnalytics[];
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

// ─── Разбор (Э8.10, §7.3 ТЗ: «показать правильный ответ всем, вынести чей-то
// ответ на доску») ──────────────────────────────────────────────────────────

/** Учитель: начать разбор задания. Идемпотентно — повторный вызов не двигает `reviewedAt`. */
export interface StartReviewResult {
  activityId: string;
  reviewedAt: string;
}

/**
 * Ответ `GET /activities/:id/review` — материал ПОЛНОСТЬЮ, с ключами
 * ответов (в отличие от `MyActivity.material`). Доступен и ученику, и
 * учителю, но ТОЛЬКО после того, как учитель явно начал разбор
 * (`activity.reviewedAt` не `null`) — до этого момента сервер отвечает
 * 409, ключи ответов не текут раньше времени ни по какому пути.
 */
export interface ActivityReview {
  activityId: string;
  reviewedAt: string;
  material: Material;
}

/** Один ответ ученика на конкретный вопрос — для учительского выбора «чей ответ вынести на доску». */
export interface ReviewStudentResponse {
  userId: string;
  fullName: string;
  response: QuestionResponse;
}

/** Ответ `GET /activities/:id/review/questions/:questionId/responses` — учителю, только во время/после разбора. */
export interface ReviewQuestionResponses {
  questionId: string;
  responses: ReviewStudentResponse[];
}

/** Тело `POST /activities/:id/review/board` — учитель выносит чей-то ответ на доску урока (§7.3 ТЗ: «анонимно или с именем»). */
export const pushAnswerToBoardRequestSchema = z.object({
  questionId: z.string().min(1),
  userId: z.string().uuid(),
  anonymous: z.boolean().default(true),
});
export type PushAnswerToBoardRequest = z.infer<typeof pushAnswerToBoardRequestSchema>;
