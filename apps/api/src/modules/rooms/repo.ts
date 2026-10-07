import { eq, and, isNull, lt, lte, gte, desc, asc, count, or, inArray, sql } from "drizzle-orm";
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

function identityMatch(identity: { userId: string | null; guestId: string | null }) {
  return identity.guestId
    ? eq(lessonParticipants.guestId, identity.guestId)
    : eq(lessonParticipants.userId, identity.userId!);
}

/**
 * G-06: последняя сессия личности в уроке и сколько сессий она открыла с
 * `since` — решить, писать ли новую строку журнала или продолжить последнюю.
 */
export async function findSessionHistory(
  lessonId: string,
  identity: { userId: string | null; guestId: string | null },
  since: Date,
): Promise<{ latest: { id: string; leftAt: Date | null } | null; recent: number }> {
  const rows = await db
    .select({ id: lessonParticipants.id, leftAt: lessonParticipants.leftAt, joinedAt: lessonParticipants.joinedAt })
    .from(lessonParticipants)
    .where(and(eq(lessonParticipants.lessonId, lessonId), identityMatch(identity), gte(lessonParticipants.joinedAt, since)))
    .orderBy(desc(lessonParticipants.joinedAt));
  if (rows.length > 0) return { latest: { id: rows[0]!.id, leftAt: rows[0]!.leftAt }, recent: rows.length };
  const [older] = await db
    .select({ id: lessonParticipants.id, leftAt: lessonParticipants.leftAt })
    .from(lessonParticipants)
    .where(and(eq(lessonParticipants.lessonId, lessonId), identityMatch(identity)))
    .orderBy(desc(lessonParticipants.joinedAt))
    .limit(1);
  return { latest: older ?? null, recent: 0 };
}

/** G-06: продолжить закрытую сессию (снова «в уроке») вместо новой строки журнала. */
export async function reopenSession(id: string): Promise<void> {
  await db.update(lessonParticipants).set({ leftAt: null }).where(eq(lessonParticipants.id, id));
}

/**
 * Э12.5 — «каноническая» строка участника урока: самая ранняя (`joined_at ASC`)
 * из строк одного `guestId`/`userId` в уроке. Строки `lesson_participants`
 * никогда не удаляются (`closeOpenSession` лишь ставит `left_at`), поэтому
 * самая ранняя стабильна на всё время урока — к ней и привязываются ответы
 * на задания (`responses.participant_id`), переживая переподключения.
 */
export async function findCanonicalParticipant(
  lessonId: string,
  identity: { userId: string | null; guestId: string | null },
): Promise<{ id: string; kind: "staff" | "guest"; displayName: string } | null> {
  const idMatch = identity.guestId
    ? eq(lessonParticipants.guestId, identity.guestId)
    : eq(lessonParticipants.userId, identity.userId!);
  const rows = await db
    .select({
      id: lessonParticipants.id,
      kind: lessonParticipants.kind,
      displayName: sql<string>`coalesce(${lessonParticipants.displayName}, ${users.fullName}, 'Участник')`,
    })
    .from(lessonParticipants)
    .leftJoin(users, eq(users.id, lessonParticipants.userId))
    .where(and(eq(lessonParticipants.lessonId, lessonId), idMatch))
    .orderBy(asc(lessonParticipants.joinedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Занятие постоянного урока укладывается в сутки: шире окно — захватит прошлые или следующие занятия. */
const ROSTER_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Ростер участников урока для учительских панелей заданий (Э12.5) —
 * канонические строки (по одной на `guestId`/`userId`), самые ранние.
 * `kind` позволяет вызывающему отфильтровать только учеников.
 *
 * Урок постоянный: журнал посещений копит всех, кто когда-либо входил по
 * ссылке (на стенде — 52 человека за 12 дней). Поэтому берём только тех,
 * кто был на занятии вокруг момента `around` (вошёл в окне ±12 ч и не ушёл
 * раньше), плюс явно переданных `engagedIds` (ответившие на задание), —
 * иначе учитель видел десятки «не начал» из прошлых недель, а опрос
 * прогресса раз в 4 с перечитывал всю историю урока.
 */
export async function listCanonicalParticipants(
  lessonId: string,
  around: Date,
  engagedIds: string[],
): Promise<{ id: string; kind: "staff" | "guest"; displayName: string; identityId: string }[]> {
  const present = and(
    gte(lessonParticipants.joinedAt, new Date(around.getTime() - ROSTER_WINDOW_MS)),
    lte(lessonParticipants.joinedAt, new Date(around.getTime() + ROSTER_WINDOW_MS)),
    or(isNull(lessonParticipants.leftAt), gte(lessonParticipants.leftAt, around)),
  );
  const identities = await db
    .select({ guestId: lessonParticipants.guestId, userId: lessonParticipants.userId })
    .from(lessonParticipants)
    .where(
      and(
        eq(lessonParticipants.lessonId, lessonId),
        engagedIds.length > 0 ? or(present, inArray(lessonParticipants.id, engagedIds)) : present,
      ),
    );
  const guestIds = [...new Set(identities.map((r) => r.guestId).filter((v): v is string => v !== null))];
  const userIds = [...new Set(identities.map((r) => r.userId).filter((v): v is string => v !== null))];
  if (guestIds.length === 0 && userIds.length === 0) return [];

  const identityMatch = [
    ...(guestIds.length > 0 ? [inArray(lessonParticipants.guestId, guestIds)] : []),
    ...(userIds.length > 0 ? [inArray(lessonParticipants.userId, userIds)] : []),
  ];
  const rows = await db
    .select({
      id: lessonParticipants.id,
      kind: lessonParticipants.kind,
      guestId: lessonParticipants.guestId,
      userId: lessonParticipants.userId,
      joinedAt: lessonParticipants.joinedAt,
      displayName: sql<string>`coalesce(${lessonParticipants.displayName}, ${users.fullName}, 'Участник')`,
    })
    .from(lessonParticipants)
    .leftJoin(users, eq(users.id, lessonParticipants.userId))
    .where(and(eq(lessonParticipants.lessonId, lessonId), or(...identityMatch)))
    .orderBy(asc(lessonParticipants.joinedAt));

  const seen = new Set<string>();
  const canonical: { id: string; kind: "staff" | "guest"; displayName: string; identityId: string }[] = [];
  for (const r of rows) {
    const key = r.guestId ?? r.userId ?? r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    canonical.push({ id: r.id, kind: r.kind, displayName: r.displayName, identityId: key });
  }
  return canonical;
}

/** Имена участников по id строк `lesson_participants` (Э12.5) — для очереди проверки. */
export async function findParticipantNames(
  ids: string[],
): Promise<Map<string, { displayName: string; kind: "staff" | "guest" }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: lessonParticipants.id,
      kind: lessonParticipants.kind,
      displayName: sql<string>`coalesce(${lessonParticipants.displayName}, ${users.fullName}, 'Участник')`,
    })
    .from(lessonParticipants)
    .leftJoin(users, eq(users.id, lessonParticipants.userId))
    .where(inArray(lessonParticipants.id, ids));
  return new Map(rows.map((r) => [r.id, { displayName: r.displayName, kind: r.kind }]));
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
      guestId: chatMessages.guestId,
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

/** Presence-id (= LiveKit identity) по строке журнала: `guest_id` гостя или `user_id` персонала. */
export async function findPresenceId(lessonParticipantId: string): Promise<string | null> {
  const rows = await db
    .select({ guestId: lessonParticipants.guestId, userId: lessonParticipants.userId })
    .from(lessonParticipants)
    .where(eq(lessonParticipants.id, lessonParticipantId))
    .limit(1);
  return rows[0]?.guestId ?? rows[0]?.userId ?? null;
}

/** Сообщения чата старше срока хранения — удаляются целиком (152-ФЗ: не храним дольше нужного). */
export async function deleteChatMessagesBefore(before: Date): Promise<number> {
  const rows = await db
    .delete(chatMessages)
    .where(lt(chatMessages.createdAt, before))
    .returning({ id: chatMessages.id });
  return rows.length;
}
