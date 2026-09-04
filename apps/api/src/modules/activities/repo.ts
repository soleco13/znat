import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { activities, materials, materialVersions, responses } from "../../db/schema.js";
import type { ActivityMode, QuestionResponse } from "@school/shared";

/**
 * Активность вместе с координатами материала (Э8.2: `activities` ссылается
 * на `material_versions`, `schoolId` берётся джойном через `materials`).
 */
export interface ActivityRow {
  id: string;
  lessonId: string | null;
  materialVersionId: string;
  materialId: string;
  materialVersion: number;
  schoolId: string;
  mode: ActivityMode;
  deadline: Date | null;
  timerSeconds: number | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

const activitySelection = {
  id: activities.id,
  lessonId: activities.lessonId,
  materialVersionId: activities.materialVersionId,
  materialId: materialVersions.materialId,
  materialVersion: materialVersions.version,
  schoolId: materials.schoolId,
  mode: activities.mode,
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
