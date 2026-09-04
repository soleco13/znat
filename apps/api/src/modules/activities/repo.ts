import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { activities, materials, materialVersions, responses, users } from "../../db/schema.js";
import type { ActivityMode, QuestionResponse } from "@school/shared";

/**
 * Активность вместе с координатами материала (Э8.2: `activities` ссылается
 * на `material_versions`, `schoolId` берётся джойном через `materials`).
 */
export interface ActivityRow {
  id: string;
  lessonId: string | null;
  /** Группа выдачи (Э8.11) — заполнено всегда, для обоих режимов. См. докстринг `activities.groupId` в схеме БД. */
  groupId: string;
  materialVersionId: string;
  materialId: string;
  materialVersion: number;
  schoolId: string;
  mode: ActivityMode;
  /** Кто выдал (Э8.11) — владение домашней работой держится на этом (у группы нет отдельного «хозяина»-учителя, в отличие от урока). */
  assignedBy: string;
  deadline: Date | null;
  timerSeconds: number | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

const activitySelection = {
  id: activities.id,
  lessonId: activities.lessonId,
  groupId: activities.groupId,
  materialVersionId: activities.materialVersionId,
  materialId: materialVersions.materialId,
  materialVersion: materialVersions.version,
  schoolId: materials.schoolId,
  mode: activities.mode,
  assignedBy: activities.assignedBy,
  deadline: activities.deadline,
  timerSeconds: activities.timerSeconds,
  createdAt: activities.createdAt,
  reviewedAt: activities.reviewedAt,
};

function withMaterial() {
  return db
    .select(activitySelection)
    .from(activities)
    .innerJoin(materialVersions, eq(materialVersions.id, activities.materialVersionId))
    .innerJoin(materials, eq(materials.id, materialVersions.materialId));
}

export async function insertActivity(input: {
  materialVersionId: string;
  lessonId: string | null;
  groupId: string;
  mode: ActivityMode;
  assignedBy: string;
  deadline: Date | null;
  timerSeconds: number | null;
}): Promise<string> {
  const [row] = await db.insert(activities).values(input).returning({ id: activities.id });
  return row!.id;
}

export async function findActivityById(id: string): Promise<ActivityRow | null> {
  const rows = await withMaterial().where(eq(activities.id, id)).limit(1);
  return (rows[0] as ActivityRow | undefined) ?? null;
}

export async function listActivitiesByLesson(lessonId: string): Promise<ActivityRow[]> {
  const rows = await withMaterial()
    .where(eq(activities.lessonId, lessonId))
    .orderBy(desc(activities.createdAt));
  return rows as ActivityRow[];
}

/** Домашние задания группы (Э8.11) — `mode = 'homework'`, вне зависимости от того, кто их выдал. */
export async function listHomeworkActivitiesByGroup(groupId: string): Promise<ActivityRow[]> {
  const rows = await withMaterial()
    .where(and(eq(activities.groupId, groupId), eq(activities.mode, "homework")))
    .orderBy(desc(activities.createdAt));
  return rows as ActivityRow[];
}

/**
 * Начать разбор (Э8.10) — идемпотентно: `COALESCE` не двигает уже
 * выставленный `reviewedAt` при повторном вызове (учитель мог нажать
 * «начать разбор» второй раз, например после перезагрузки страницы).
 */
export async function markReviewed(id: string): Promise<Date> {
  const [row] = await db
    .update(activities)
    .set({ reviewedAt: sql`coalesce(${activities.reviewedAt}, now())` })
    .where(eq(activities.id, id))
    .returning({ reviewedAt: activities.reviewedAt });
  return row!.reviewedAt!;
}

/** Наибольший номер попытки этого ученика по этой активности; 0 — попыток ещё не было. */
export async function maxAttemptNumber(activityId: string, userId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${responses.attemptNumber})` })
    .from(responses)
    .where(and(eq(responses.activityId, activityId), eq(responses.userId, userId)));
  return rows[0]?.max ?? 0;
}

export interface SavedResponseRow {
  questionId: string;
  response: QuestionResponse;
}

/** Черновики ответов конкретной попытки (по `attemptId`) — для возобновления. */
export async function findResponsesByAttempt(attemptId: string): Promise<SavedResponseRow[]> {
  const rows = await db
    .select({ questionId: responses.questionId, response: responses.response })
    .from(responses)
    .where(eq(responses.attemptId, attemptId));
  return rows.map((r) => ({ questionId: r.questionId, response: r.response as QuestionResponse }));
}

/**
 * Все черновики ответов активности (Э8.9) — для агрегации по вопросам.
 * Класс-масштаб (≤30 учеников × ≤N вопросов), агрегируется в JS, а не
 * SQL-разбором JSONB: типов ответа 10, каждый со своей формой.
 */
export async function listResponsesByActivity(
  activityId: string,
): Promise<{ userId: string; questionId: string; response: QuestionResponse }[]> {
  const rows = await db
    .select({ userId: responses.userId, questionId: responses.questionId, response: responses.response })
    .from(responses)
    .where(eq(responses.activityId, activityId));
  return rows.map((r) => ({ userId: r.userId, questionId: r.questionId, response: r.response as QuestionResponse }));
}

/**
 * Сводка ответов по ученикам одной активности (Э8.8) — сколько РАЗНЫХ
 * вопросов отвечено и когда было последнее сохранение. Попытка у ученика
 * фактически одна (`attemptId` детерминирован), поэтому группируем просто
 * по `userId`.
 */
export async function answeredStatsByActivity(
  activityId: string,
): Promise<{ userId: string; answered: number; lastAt: string }[]> {
  const rows = await db
    .select({
      userId: responses.userId,
      answered: sql<number>`count(distinct ${responses.questionId})::int`,
      lastAt: sql<string>`max(${responses.submittedAt})::text`,
    })
    .from(responses)
    .where(eq(responses.activityId, activityId))
    .groupBy(responses.userId);
  return rows;
}

/**
 * Автосохранение черновика одного ответа (Э8.7). Upsert по естественному
 * ключу `(attemptId, questionId)` — уникальный индекс
 * `responses_attempt_question_idx` (Э8.2 завёл его ровно под эту цель):
 * один ответ на вопрос одной попытки, повторное сохранение перезаписывает.
 * Черновик НЕ оценивается — `score`/`maxScore` остаются NULL, `autoGraded`
 * = false (движок проверки Э8.3 отработает на сабмите). `submittedAt`
 * здесь — момент последнего сохранения.
 */
export async function upsertDraftResponse(input: {
  attemptId: string;
  activityId: string;
  materialId: string;
  lessonId: string | null;
  userId: string;
  questionId: string;
  response: QuestionResponse;
  attemptNumber: number;
  timeSpentMs: number;
}): Promise<Date> {
  const now = new Date();
  const [row] = await db
    .insert(responses)
    .values({
      attemptId: input.attemptId,
      activityId: input.activityId,
      materialId: input.materialId,
      lessonId: input.lessonId,
      userId: input.userId,
      questionId: input.questionId,
      response: input.response,
      autoGraded: false,
      timeSpentMs: input.timeSpentMs,
      attemptNumber: input.attemptNumber,
      submittedAt: now,
    })
    .onConflictDoUpdate({
      target: [responses.attemptId, responses.questionId],
      set: {
        response: input.response,
        timeSpentMs: sql`greatest(${responses.timeSpentMs}, ${input.timeSpentMs})`,
        submittedAt: now,
      },
    })
    .returning({ submittedAt: responses.submittedAt });
  return row?.submittedAt ?? now;
}

/**
 * Момент сабмита попытки (Э8.12) — `max(submittedAt)` среди строк, уже
 * помеченных `submitted = true`. `null` — попытка ещё не сдана (черновики
 * можно продолжать сохранять).
 */
export async function attemptSubmittedAt(attemptId: string): Promise<Date | null> {
  const rows = await db
    .select({ submittedAt: sql<string | null>`max(${responses.submittedAt})::text` })
    .from(responses)
    .where(and(eq(responses.attemptId, attemptId), eq(responses.submitted, true)));
  const value = rows[0]?.submittedAt;
  return value ? new Date(value) : null;
}

/** Минимальный контракт результата движка проверки (Э8.3), нужный репозиторию для записи. */
export interface GradeResultInput {
  score: number;
  maxScore: number;
  autoGraded: boolean;
}

/**
 * Финализирует один ответ на сабмите (Э8.12): upsert по `(attemptId, questionId)`
 * — та же цель, что у `upsertDraftResponse`, но с результатом проверки и
 * `submitted = true`. **Для `autoGraded: false` (ручные типы — `open_answer`)
 * при повторном сабмите НЕ трогает `score`/`autoGraded`/`gradedAt`** — если
 * учитель уже успел проверить ответ (`POST /grading/:responseId`), поле
 * `set` их просто не перечисляет, и `onConflictDoUpdate` их не меняет.
 * Затирать уже выставленную учителем оценку повторным сабмитом того же
 * ответа нельзя ни при каких условиях (§ «Что не делегировать вслепую»
 * CLAUDE.md — соседняя область с движком проверки).
 */
export async function upsertGradedResponse(input: {
  attemptId: string;
  activityId: string;
  materialId: string;
  lessonId: string | null;
  userId: string;
  questionId: string;
  response: QuestionResponse;
  attemptNumber: number;
  result: GradeResultInput;
}): Promise<void> {
  const now = new Date();
  const { result } = input;
  await db
    .insert(responses)
    .values({
      attemptId: input.attemptId,
      activityId: input.activityId,
      materialId: input.materialId,
      lessonId: input.lessonId,
      userId: input.userId,
      questionId: input.questionId,
      response: input.response,
      score: result.autoGraded ? String(result.score) : null,
      maxScore: String(result.maxScore),
      autoGraded: result.autoGraded,
      gradedAt: result.autoGraded ? now : null,
      submitted: true,
      attemptNumber: input.attemptNumber,
      submittedAt: now,
    })
    .onConflictDoUpdate({
      target: [responses.attemptId, responses.questionId],
      set: {
        response: input.response,
        maxScore: String(result.maxScore),
        submitted: true,
        submittedAt: now,
        ...(result.autoGraded ? { score: String(result.score), autoGraded: true, gradedAt: now } : {}),
      },
    });
}

// ─── Ручная проверка (Э8.12, §6.4/§8 ТЗ) ───────────────────────────────────

export interface PendingManualGradingRow {
  responseId: string;
  activityId: string;
  activityMode: ActivityMode;
  materialVersionId: string;
  questionId: string;
  response: QuestionResponse;
  studentId: string;
  studentFullName: string;
  submittedAt: Date;
}

/**
 * Очередь ручной проверки — сданные (`submitted = true`), ещё не
 * проверенные (`gradedBy IS NULL`) ответы ручных типов. `autoGraded = false`
 * после сабмита однозначно означает `open_answer` (Э8.3: только он
 * возвращает `autoGraded: false`), отдельно проверять `response.type` не
 * нужно. `assignedBy` — тот же критерий владения, что и у остальных
 * учительских ручек (`assertActivityOwner`): для `lesson`-выдачи это
 * учитель урока (см. `createActivity`), для `homework` — кто её задал.
 * `null` — без фильтра по владельцу (роль admin, видит всю школу).
 */
export async function listPendingManualGrading(
  schoolId: string,
  assignedBy: string | null,
): Promise<PendingManualGradingRow[]> {
  const conditions = [
    eq(materials.schoolId, schoolId),
    eq(responses.submitted, true),
    eq(responses.autoGraded, false),
    isNull(responses.gradedBy),
  ];
  if (assignedBy) conditions.push(eq(activities.assignedBy, assignedBy));

  const rows = await db
    .select({
      responseId: responses.id,
      activityId: responses.activityId,
      activityMode: activities.mode,
      materialVersionId: activities.materialVersionId,
      questionId: responses.questionId,
      response: responses.response,
      studentId: users.id,
      studentFullName: users.fullName,
      submittedAt: responses.submittedAt,
    })
    .from(responses)
    .innerJoin(activities, eq(activities.id, responses.activityId))
    .innerJoin(materialVersions, eq(materialVersions.id, activities.materialVersionId))
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .innerJoin(users, eq(users.id, responses.userId))
    .where(and(...conditions))
    .orderBy(responses.submittedAt);

  return rows.map((r) => ({ ...r, response: r.response as QuestionResponse }));
}

export interface ManualGradingTargetRow {
  id: string;
  assignedBy: string;
  schoolId: string;
  materialVersionId: string;
  questionId: string;
  gradedBy: string | null;
  autoGraded: boolean;
  submitted: boolean;
}

/** Один ответ по `responseId` вместе с координатами, нужными для авторизации и поиска вопроса (Э8.12). */
export async function findResponseForGrading(responseId: string): Promise<ManualGradingTargetRow | null> {
  const rows = await db
    .select({
      id: responses.id,
      assignedBy: activities.assignedBy,
      schoolId: materials.schoolId,
      materialVersionId: activities.materialVersionId,
      questionId: responses.questionId,
      gradedBy: responses.gradedBy,
      autoGraded: responses.autoGraded,
      submitted: responses.submitted,
    })
    .from(responses)
    .innerJoin(activities, eq(activities.id, responses.activityId))
    .innerJoin(materialVersions, eq(materialVersions.id, activities.materialVersionId))
    .innerJoin(materials, eq(materials.id, materialVersions.materialId))
    .where(eq(responses.id, responseId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Записывает результат ручной проверки — ТОЛЬКО если ответ ещё не проверен
 * (`graded_by IS NULL` в условии `WHERE`, а не отдельной проверкой до
 * записи): защита от гонки двух одновременных `POST /grading/:responseId`
 * по одному ответу (например, два открытых окна одного учителя). Возвращает
 * `null`, если строка уже была проверена — сервис превращает это в 409.
 */
export async function persistManualGrade(
  responseId: string,
  input: { score: number; rubricScores: Record<string, boolean>; comment: string | null; gradedBy: string },
): Promise<Date | null> {
  const now = new Date();
  const [row] = await db
    .update(responses)
    .set({
      score: String(input.score),
      rubricScores: input.rubricScores,
      comment: input.comment,
      gradedBy: input.gradedBy,
      gradedAt: now,
    })
    .where(and(eq(responses.id, responseId), isNull(responses.gradedBy)))
    .returning({ gradedAt: responses.gradedAt });
  return row?.gradedAt ?? null;
}
