import { eq, and, ilike, or, count, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { Role } from "@school/shared";

export async function insertUser(input: {
  schoolId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
}) {
  const [row] = await db.insert(users).values(input).returning();
  return row;
}

export async function updateUser(
  id: string,
  schoolId: string,
  patch: Partial<{ fullName: string; role: Role; isActive: boolean }>,
) {
  const [row] = await db
    .update(users)
    .set(patch)
    .where(and(eq(users.id, id), eq(users.schoolId, schoolId)))
    .returning();
  return row ?? null;
}

export async function findUserById(id: string, schoolId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.schoolId, schoolId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Имена по набору id (Э12: обогащение списка уроков `teacherName`, журнала посещений). */
export async function findUsersByIds(
  schoolId: string,
  ids: string[],
): Promise<{ id: string; fullName: string; role: Role }[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: users.id, fullName: users.fullName, role: users.role })
    .from(users)
    .where(and(eq(users.schoolId, schoolId), inArray(users.id, ids)));
}

export async function listUsers(input: {
  schoolId: string;
  role?: Role;
  q?: string;
  page: number;
  pageSize: number;
}) {
  const conditions = [eq(users.schoolId, input.schoolId)];
  if (input.role) conditions.push(eq(users.role, input.role));
  if (input.q) {
    conditions.push(or(ilike(users.email, `%${input.q}%`), ilike(users.fullName, `%${input.q}%`))!);
  }
  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(where)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .orderBy(users.createdAt),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return { rows, total: totalRows[0]?.total ?? 0 };
}

