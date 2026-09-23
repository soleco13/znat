import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { schools, users, emailVerificationTokens } from "../../db/schema.js";
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
    await tx.update(emailVerificationTokens).set({ consumedAt: new Date() }).where(eq(emailVerificationTokens.id, tokenId));
    const [user] = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user ?? null;
  });
}
