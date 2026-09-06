import { eq, and, isNull, lt, desc, count, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { lessonParticipants, chatMessages, users } from "../../db/schema.js";

/**
 * Строка журнала посещений (Э12.4). Персонал — `userId`; гость-ученик —
 * `guestId` + `displayName` (введённое имя, ПДн), `userId` NULL.
 */
export async function insertJoin(input: {
  lessonId: string;
  kind: "staff" | "guest";
  userId: string | null;
  guestId: string | null;
  displayName: string | null;
}) {
  const [row] = await db.insert(lessonParticipants).values(input).returning();
  return row;
}

/**
 * Закрывает самую свежую открытую сессию участника (leftAt IS NULL) в этом
 * уроке. `participantId` — `users.id` персонала ИЛИ `guest_id` ученика
 * (совпадает с presence-ключом и LiveKit-identity).
 */
export async function closeOpenSession(lessonId: string, participantId: string) {
  await db
    .update(lessonParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(lessonParticipants.lessonId, lessonId),
        or(
          eq(lessonParticipants.userId, participantId),
          eq(lessonParticipants.guestId, participantId),
        ),
        isNull(lessonParticipants.leftAt),
      ),
    );
}

export async function insertChatMessage(input: {
  lessonId: string;
  userId: string | null;
  guestId: string | null;
  authorName: string;
  body: string;
}) {
  const [row] = await db.insert(chatMessages).values(input).returning();
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
      // Э12.4: имя автора — денормализованное `author_name` (обязательно у
      // гостя, нет строки `users`), с откатом на `users.full_name` для
      // старых строк персонала до миграции.
      authorName: sql<string>`coalesce(${chatMessages.authorName}, ${users.fullName}, 'Участник')`,
    })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.userId))
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
