import { eq, and, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, refreshTokens, passwordResetTokens } from "../../db/schema.js";

export async function findUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function touchLastLogin(userId: string) {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export async function insertRefreshToken(input: {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}) {
  await db.insert(refreshTokens).values(input);
}

export async function findActiveRefreshToken(tokenHash: string) {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRefreshTokenByHash(tokenHash: string) {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function rotateRefreshToken(input: {
  oldTokenHash: string;
  newTokenHash: string;
}) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedByHash: input.newTokenHash })
    // Только ещё действующий: одновременная ротация тем же токеном не
    // перезаписывает момент первой ротации (от него считается окно гонки).
    .where(and(eq(refreshTokens.tokenHash, input.oldTokenHash), isNull(refreshTokens.revokedAt)));
}

export async function revokeFamily(familyId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/** Истёкший refresh-токен всё равно отвергается по сроку — строка больше ни для чего не нужна. */
export async function deleteExpiredRefreshTokens(now: Date): Promise<number> {
  const rows = await db
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, now))
    .returning({ id: refreshTokens.id });
  return rows.length;
}

/** Все сессии пользователя — после смены или сброса пароля старые входы не должны жить. */
export async function revokeAllForUser(userId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function updatePasswordHash(userId: string, passwordHash: string) {
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function insertPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
  await db.insert(passwordResetTokens).values(input);
}

/**
 * Сброс пароля по ссылке одной транзакцией: токен помечается использованным
 * (только если ещё не был — две вкладки с одной ссылкой не сработают
 * дважды), пароль меняется, почта считается подтверждённой (человек
 * доказал, что владеет ящиком), все сессии отзываются.
 */
export async function consumePasswordReset(tokenHash: string, passwordHash: string, now: Date) {
  return db.transaction(async (tx) => {
    const [token] = await tx
      .update(passwordResetTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });
    if (!token) return null;
    const [user] = await tx
      .update(users)
      .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})` })
      .where(eq(users.id, token.userId))
      .returning({ id: users.id });
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, token.userId), isNull(refreshTokens.revokedAt)));
    return user ?? null;
  });
}
