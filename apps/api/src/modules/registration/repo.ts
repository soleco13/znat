import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { schools, users, emailVerificationTokens, schoolInvites } from "../../db/schema.js";
import type { Role, SchoolKind } from "@school/shared";

export async function slugExists(slug: string): Promise<boolean> {
  const rows = await db.select({ id: schools.id }).from(schools).where(eq(schools.slug, slug)).limit(1);
  return rows.length > 0;
}

export async function findSchoolBySlug(slug: string) {
  const rows = await db.select().from(schools).where(eq(schools.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/**
 * Атомарно создаёт пространство (школу), первого пользователя в нём
 * (`role: admin` — self-signup всегда основывает пространство) и токен
 * подтверждения почты. Одна транзакция (паттерн `materials/repo.ts::insertMaterial`)
 * — сбой на любом шаге (например, дубликат email) не оставляет школу-сироту
 * без пользователя.
 */
export async function registerSchoolWithAdmin(input: {
  schoolName: string;
  slug: string;
  kind: SchoolKind;
  inn?: string;
  ogrn?: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  verificationTokenHash: string;
  verificationExpiresAt: Date;
}) {
  return db.transaction(async (tx) => {
    const [school] = await tx
      .insert(schools)
      .values({ name: input.schoolName, slug: input.slug, kind: input.kind, inn: input.inn, ogrn: input.ogrn })
      .returning();
    const [user] = await tx
      .insert(users)
      .values({
        schoolId: school!.id,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
        personalDataConsentAt: new Date(),
      })
      .returning();
    await tx.insert(emailVerificationTokens).values({
      userId: user!.id,
      tokenHash: input.verificationTokenHash,
      expiresAt: input.verificationExpiresAt,
    });
    return { school: school!, user: user! };
  });
}

/**
 * Э14.2 — присоединение к чужому пространству по инвайту. Атомарный "захват
 * слота" — `UPDATE ... WHERE <ещё валиден> RETURNING` в одной транзакции с
 * созданием пользователя: если инвайт не найден/просрочен/отозван/исчерпан,
 * `invite` будет `null` и пользователь не создаётся; если следом упадёт
 * инсерт юзера (дубликат email), откатится и инкремент `useCount` — инвайт
 * не сгорает впустую на чужой ошибке.
 */
export async function joinSchoolViaInvite(input: {
  inviteCodeHash: string;
  email: string;
  passwordHash: string;
  fullName: string;
  verificationTokenHash: string;
  verificationExpiresAt: Date;
}) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [invite] = await tx
      .update(schoolInvites)
      .set({ useCount: sql`${schoolInvites.useCount} + 1` })
      .where(
        and(
          eq(schoolInvites.codeHash, input.inviteCodeHash),
          isNull(schoolInvites.revokedAt),
          or(isNull(schoolInvites.expiresAt), gt(schoolInvites.expiresAt, now)),
          or(isNull(schoolInvites.maxUses), lt(schoolInvites.useCount, schoolInvites.maxUses)),
        ),
      )
      .returning();
    if (!invite) {
      return null;
    }

    const [user] = await tx
      .insert(users)
      .values({
        schoolId: invite.schoolId,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: invite.role,
        personalDataConsentAt: new Date(),
      })
      .returning();
    await tx.insert(emailVerificationTokens).values({
      userId: user!.id,
      tokenHash: input.verificationTokenHash,
      expiresAt: input.verificationExpiresAt,
    });
    return { user: user!, invite };
  });
}

export async function findEmailVerificationTokenByHash(tokenHash: string) {
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

/** Помечает токен использованным и почту подтверждённой одной транзакцией. */
export async function consumeVerificationToken(tokenId: string, userId: string) {
  return db.transaction(async (tx) => {
    // Условие на consumedAt — два одновременных перехода по одной ссылке не
    // выдают две сессии: второй не найдёт строку и получит null.
    const [token] = await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(emailVerificationTokens.id, tokenId), isNull(emailVerificationTokens.consumedAt)))
      .returning({ id: emailVerificationTokens.id });
    if (!token) return null;
    const [user] = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user ?? null;
  });
}

export async function findUnverifiedUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.emailVerifiedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertVerificationToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
  await db.insert(emailVerificationTokens).values(input);
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23503";
}

/**
 * Удаляет неподтверждённый аккаунт, если у него не осталось действующей
 * ссылки подтверждения, и его пространство, если в нём больше никого нет.
 * Так чужой email, на который кто-то зарегистрировался и бросил, через сутки
 * снова свободен для настоящего владельца. Аккаунт, успевший что-то создать
 * (до проверки почты при входе это было возможно), не трогаем — внешние
 * ключи `restrict` откатят удаление, возвращаем `false`.
 */
export async function deleteStaleUnverifiedUser(userId: string, now: Date): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, schoolId: users.schoolId })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
        .limit(1);
      if (!user) return false;
      const [live] = await tx
        .select({ n: count() })
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.userId, userId),
            isNull(emailVerificationTokens.consumedAt),
            gt(emailVerificationTokens.expiresAt, now),
          ),
        );
      if ((live?.n ?? 0) > 0) return false;
      await tx.delete(users).where(eq(users.id, userId));
      const [rest] = await tx.select({ n: count() }).from(users).where(eq(users.schoolId, user.schoolId));
      if ((rest?.n ?? 0) === 0) {
        await tx.delete(schools).where(eq(schools.id, user.schoolId));
      }
      return true;
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) return false;
    throw err;
  }
}

/** Неподтверждённые аккаунты старше `before` — кандидаты на удаление фоновой чисткой. */
export async function listUnverifiedUsersCreatedBefore(before: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNull(users.emailVerifiedAt), lt(users.createdAt, before)))
    .limit(limit);
  return rows.map((r) => r.id);
}
