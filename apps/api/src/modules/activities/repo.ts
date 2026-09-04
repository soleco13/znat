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
