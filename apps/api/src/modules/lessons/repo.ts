import { eq, and, gte, lte, count, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { lessons } from "../../db/schema.js";
import type { LessonStatus } from "@school/shared";

export async function insertLesson(input: {
  schoolId: string;
  groupId: string;
  teacherId: string;
  title: string;
  subject: string;
  startsAt: Date;
  durationMin: number;
}) {
  const [row] = await db.insert(lessons).values(input).returning();
  return row;
}

export async function findLessonById(id: string, schoolId: string) {
  const rows = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateLessonStatus(
  id: string,
  schoolId: string,
  patch: { status: LessonStatus; startedAt?: Date; endedAt?: Date },
) {
  const [row] = await db
    .update(lessons)
    .set(patch)
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId)))
    .returning();
  return row ?? null;
}

/** Идемпотентно: WHERE livekit_room IS NULL — не перезаписывает уже назначенную комнату. */
export async function setLivekitRoomIfEmpty(id: string, schoolId: string, livekitRoom: string) {
  const [row] = await db
    .update(lessons)
    .set({ livekitRoom })
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId), sql`${lessons.livekitRoom} IS NULL`))
    .returning();
  return row ?? null;
}

export async function listLessons(input: {
  schoolId: string;
  from?: Date;
  to?: Date;
  teacherId?: string;
  page: number;
  pageSize: number;
}) {
  const conditions: SQL[] = [eq(lessons.schoolId, input.schoolId)];
  if (input.from) conditions.push(gte(lessons.startsAt, input.from));
  if (input.to) conditions.push(lte(lessons.startsAt, input.to));
  if (input.teacherId) conditions.push(eq(lessons.teacherId, input.teacherId));
  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(lessons)
      .where(where)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .orderBy(lessons.startsAt),
    db.select({ total: count() }).from(lessons).where(where),
  ]);

  return { rows, total: totalRows[0]?.total ?? 0 };
}
