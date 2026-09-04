import { eq, and, ilike, or, count } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, groups, groupMembers } from "../../db/schema.js";
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

export async function insertGroup(input: {
  schoolId: string;
  name: string;
  grade: number;
  academicYear: string;
}) {
  const [row] = await db.insert(groups).values(input).returning();
  return row;
}

export async function listGroups(schoolId: string) {
  return db.select().from(groups).where(eq(groups.schoolId, schoolId));
}

export async function findGroupById(id: string, schoolId: string) {
  const rows = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), eq(groups.schoolId, schoolId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function addGroupMembers(groupId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  await db
    .insert(groupMembers)
    .values(userIds.map((userId) => ({ groupId, userId })))
    .onConflictDoNothing();
}

/** Ученики группы (для панели прогресса Э8.8) — только активные, с именами. */
export async function listGroupStudents(groupId: string): Promise<{ id: string; fullName: string }[]> {
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(users.role, "student"), eq(users.isActive, true)))
    .orderBy(users.fullName);
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
