import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { lessonMaterials, lessonParticipants, lessons } from "../../db/schema.js";

// ─── Урок (Э12: постоянный, без группы/расписания/статуса) ────────────────────

export async function insertLesson(input: {
  schoolId: string;
  teacherId: string;
  title: string;
  joinToken: string;
  scheduledAt: Date | null;
  settings: unknown;
}) {
  const [row] = await db
    .insert(lessons)
    .values({
      schoolId: input.schoolId,
      teacherId: input.teacherId,
      title: input.title,
      joinToken: input.joinToken,
      // `starts_at` NOT NULL с дефолтом — используем как «плановое время».
      ...(input.scheduledAt ? { startsAt: input.scheduledAt } : {}),
      settings: input.settings as Record<string, unknown>,
    })
    .returning();
  return row!;
}

export async function findLessonById(id: string, schoolId: string) {
  const rows = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Урок по токену прямой ссылки (Э12, гостевой вход `/j/:token`). Без привязки к школе — токен сам по себе секрет. */
export async function findLessonByJoinToken(joinToken: string) {
  const rows = await db.select().from(lessons).where(eq(lessons.joinToken, joinToken)).limit(1);
  return rows[0] ?? null;
}

/**
 * Урок по id без фильтра по школе — для проверки гостевой сессии (Э12.4):
 * гостевой JWT несёт `lessonId`, школа выводится из самого урока, а не из
 * сессии (у гостя её нет). Подлинность гарантируется подписью JWT и сверкой
 * хеша текущей ссылки урока (`lt` в payload).
 */
export async function findLessonByIdAnySchool(id: string) {
  const rows = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Без фильтра по schoolId: LiveKit-вебхук (Э2.7) знает только имя комнаты,
 * не школу — событие приходит от единого self-hosted LiveKit на все школы,
 * а подлинность подтверждается подписью в самом вебхуке, не сессией пользователя.
 */
export async function findLessonByLivekitRoom(livekitRoom: string) {
  const rows = await db.select().from(lessons).where(eq(lessons.livekitRoom, livekitRoom)).limit(1);
  return rows[0] ?? null;
}

export async function updateLesson(
  id: string,
  schoolId: string,
  patch: {
    title?: string;
    teacherId?: string;
    startsAt?: Date;
    settings?: Record<string, unknown>;
  },
) {
  if (Object.keys(patch).length === 0) return findLessonById(id, schoolId);
  const [row] = await db
    .update(lessons)
    .set(patch)
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId)))
    .returning();
  return row ?? null;
}

export async function setJoinToken(id: string, schoolId: string, joinToken: string) {
  const [row] = await db
    .update(lessons)
    .set({ joinToken })
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId)))
    .returning();
  return row ?? null;
}

export async function deleteLesson(id: string, schoolId: string): Promise<boolean> {
  const rows = await db
    .delete(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.schoolId, schoolId)))
    .returning({ id: lessons.id });
  return rows.length > 0;
}

/** Идемпотентно: WHERE livekit_room IS NULL — не перезаписывает уже назначенную комнату. */
export async function setLivekitRoomIfEmpty(id: string, schoolId: string, livekitRoom: string) {
  const [row] = await db
    .update(lessons)
    .set({ livekitRoom })
    .where(
      and(eq(lessons.id, id), eq(lessons.schoolId, schoolId), sql`${lessons.livekitRoom} IS NULL`),
    )
    .returning();
  return row ?? null;
}

/** Список уроков: admin — все школы; teacher — только `ownerTeacherId`. Сортировка — плановое время, свежие сверху. */
export async function listLessons(input: { schoolId: string; ownerTeacherId?: string }) {
  const conditions: SQL[] = [eq(lessons.schoolId, input.schoolId)];
  if (input.ownerTeacherId) conditions.push(eq(lessons.teacherId, input.ownerTeacherId));
  return db
    .select()
    .from(lessons)
    .where(and(...conditions))
    .orderBy(desc(lessons.startsAt));
}

// ─── Журнал посещений (`lesson_participants`) ────────────────────────────────

export async function listAttendance(lessonId: string) {
  return db
    .select({
      participantId: lessonParticipants.id,
      kind: lessonParticipants.kind,
      userId: lessonParticipants.userId,
      guestId: lessonParticipants.guestId,
      displayName: lessonParticipants.displayName,
      joinedAt: lessonParticipants.joinedAt,
      leftAt: lessonParticipants.leftAt,
    })
    .from(lessonParticipants)
    .where(eq(lessonParticipants.lessonId, lessonId))
    .orderBy(desc(lessonParticipants.joinedAt));
}

// ─── Материалы урока («домашка» — просто список, Э12 §1.3) ────────────────────

export async function listLessonMaterialRows(lessonId: string) {
  return db
    .select()
    .from(lessonMaterials)
    .where(eq(lessonMaterials.lessonId, lessonId))
    .orderBy(desc(lessonMaterials.assignedAt));
}

export async function insertLessonMaterial(input: {
  lessonId: string;
  materialId: string;
  assignedBy: string;
}) {
  const [row] = await db
    .insert(lessonMaterials)
    .values(input)
    .onConflictDoNothing({
      target: [lessonMaterials.lessonId, lessonMaterials.materialId],
    })
    .returning();
  return row ?? null;
}

export async function deleteLessonMaterial(lessonId: string, materialId: string): Promise<boolean> {
  const rows = await db
    .delete(lessonMaterials)
    .where(and(eq(lessonMaterials.lessonId, lessonId), eq(lessonMaterials.materialId, materialId)))
    .returning({ id: lessonMaterials.id });
  return rows.length > 0;
}

export async function findLessonMaterialIds(lessonId: string): Promise<string[]> {
  const rows = await db
    .select({ materialId: lessonMaterials.materialId })
    .from(lessonMaterials)
    .where(eq(lessonMaterials.lessonId, lessonId));
  return rows.map((r) => r.materialId);
}
