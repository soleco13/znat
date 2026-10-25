import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { schoolInvites, schools } from "../../db/schema.js";
import type { Role } from "@school/shared";

export async function insertInvite(input: {
  schoolId: string;
  codeHash: string;
  role: Role;
  createdBy: string;
  maxUses?: number;
  expiresAt?: Date;
  email?: string;
}) {
  const [row] = await db.insert(schoolInvites).values(input).returning();
  return row!;
}

export async function findSchoolSlug(schoolId: string): Promise<string | null> {
  const rows = await db.select({ slug: schools.slug }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return rows[0]?.slug ?? null;
}

export async function listInvitesBySchool(schoolId: string) {
  return db
    .select()
    .from(schoolInvites)
    .where(eq(schoolInvites.schoolId, schoolId))
    .orderBy(schoolInvites.createdAt);
}

export async function revokeInvite(id: string, schoolId: string) {
  const [row] = await db
    .update(schoolInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schoolInvites.id, id), eq(schoolInvites.schoolId, schoolId), isNull(schoolInvites.revokedAt)))
    .returning();
  return row ?? null;
}

export async function findInviteWithSchoolByCodeHash(codeHash: string) {
  const rows = await db
    .select({
      role: schoolInvites.role,
      maxUses: schoolInvites.maxUses,
      useCount: schoolInvites.useCount,
      expiresAt: schoolInvites.expiresAt,
      revokedAt: schoolInvites.revokedAt,
      email: schoolInvites.email,
      schoolId: schoolInvites.schoolId,
      schoolName: schools.name,
      schoolSlug: schools.slug,
    })
    .from(schoolInvites)
    .innerJoin(schools, eq(schoolInvites.schoolId, schools.id))
    .where(eq(schoolInvites.codeHash, codeHash))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Э15.2 — занять место в приглашении для вошедшего аккаунта: тот же
 * атомарный `UPDATE … WHERE <ещё валидно> RETURNING`, что при регистрации
 * по приглашению. Приглашение на почту — только для этого адреса.
 */
export async function claimInvite(codeHash: string, email: string) {
  const now = new Date();
  const [invite] = await db
    .update(schoolInvites)
    .set({ useCount: sql`${schoolInvites.useCount} + 1` })
    .where(
      and(
        eq(schoolInvites.codeHash, codeHash),
        isNull(schoolInvites.revokedAt),
        or(isNull(schoolInvites.expiresAt), gt(schoolInvites.expiresAt, now)),
        or(isNull(schoolInvites.maxUses), lt(schoolInvites.useCount, schoolInvites.maxUses)),
        or(isNull(schoolInvites.email), eq(schoolInvites.email, email)),
      ),
    )
    .returning();
  return invite ?? null;
}

/** Возврат занятого места, если членство не удалось записать. */
export async function releaseInvite(id: string) {
  await db.update(schoolInvites).set({ useCount: sql`greatest(${schoolInvites.useCount} - 1, 0)` }).where(eq(schoolInvites.id, id));
}

export async function findInviteById(id: string, schoolId: string) {
  const [row] = await db
    .select()
    .from(schoolInvites)
    .where(and(eq(schoolInvites.id, id), eq(schoolInvites.schoolId, schoolId)))
    .limit(1);
  return row ?? null;
}

/** Повторная отправка: новый код (сырой код не хранится), отметка об отправке. */
export async function rotateInviteCode(id: string, codeHash: string, expiresAt: Date | null) {
  await db.update(schoolInvites).set({ codeHash, sentAt: new Date(), expiresAt }).where(eq(schoolInvites.id, id));
}

export async function markSent(id: string) {
  await db.update(schoolInvites).set({ sentAt: new Date() }).where(eq(schoolInvites.id, id));
}

export async function findSchoolName(schoolId: string): Promise<string | null> {
  const rows = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return rows[0]?.name ?? null;
}
