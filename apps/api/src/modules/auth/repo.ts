import { eq, and, isNull, lt } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, refreshTokens } from "../../db/schema.js";

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
