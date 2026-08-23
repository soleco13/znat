import { eq, and, isNull, lt, desc, count } from "drizzle-orm";
import { db } from "../../db/client.js";
import { lessonParticipants, chatMessages, users } from "../../db/schema.js";

export async function insertJoin(lessonId: string, userId: string) {
  const [row] = await db.insert(lessonParticipants).values({ lessonId, userId }).returning();
  return row;
}

/** Закрывает самую свежую открытую сессию участника (leftAt IS NULL) в этом уроке. */
export async function closeOpenSession(lessonId: string, userId: string) {
  await db
    .update(lessonParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(lessonParticipants.lessonId, lessonId),
        eq(lessonParticipants.userId, userId),
        isNull(lessonParticipants.leftAt),
      ),
    );
}

export async function insertChatMessage(lessonId: string, userId: string, body: string) {
  const [row] = await db.insert(chatMessages).values({ lessonId, userId, body }).returning();
  return row!;
}

export async function findChatAuthor(userId: string) {
  const rows = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.fullName ?? null;
}

export async function listChatMessages(lessonId: string, before: Date | undefined, limit: number) {
  const conditions = [eq(chatMessages.lessonId, lessonId), isNull(chatMessages.deletedAt)];
  if (before) conditions.push(lt(chatMessages.createdAt, before));

  const rows = await db
    .select({
      id: chatMessages.id,
      lessonId: chatMessages.lessonId,
      userId: chatMessages.userId,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      authorName: users.fullName,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows;
}

export async function softDeleteChatMessage(lessonId: string, messageId: string, deletedBy: string) {
  const [row] = await db
    .update(chatMessages)
    .set({ deletedAt: new Date(), deletedBy })
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.lessonId, lessonId)))
    .returning();
  return row ?? null;
}

export async function countOpenSessions(lessonId: string) {
  const rows = await db
    .select({ total: count() })
    .from(lessonParticipants)
    .where(and(eq(lessonParticipants.lessonId, lessonId), isNull(lessonParticipants.leftAt)));
  return rows[0]?.total ?? 0;
}
