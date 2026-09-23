import { and, eq, isNull } from "drizzle-orm";
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
      schoolName: schools.name,
      schoolSlug: schools.slug,
    })
    .from(schoolInvites)
    .innerJoin(schools, eq(schoolInvites.schoolId, schools.id))
    .where(eq(schoolInvites.codeHash, codeHash))
    .limit(1);
  return rows[0] ?? null;
}
