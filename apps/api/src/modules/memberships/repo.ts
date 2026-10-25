import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Role } from "@school/shared";
import { db } from "../../db/client.js";
import { memberships, schools } from "../../db/schema.js";

export async function findActive(userId: string, schoolId: string) {
  const [row] = await db
    .select({ schoolId: memberships.schoolId, roles: memberships.roles, blockedAt: schools.blockedAt })
    .from(memberships)
    .innerJoin(schools, eq(schools.id, memberships.schoolId))
    .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId), isNull(memberships.removedAt)))
    .limit(1);
  return row ?? null;
}

/** Э15.4: пространство по id (вход супер-админа без членства). */
export async function findSchool(schoolId: string) {
  const [row] = await db
    .select({ id: schools.id, name: schools.name, kind: schools.kind, blockedAt: schools.blockedAt })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  return row ?? null;
}

/** Пространства пользователя: сначала последнее использованное. */
export async function listActiveForUser(userId: string) {
  return db
    .select({
      schoolId: memberships.schoolId,
      roles: memberships.roles,
      lastUsedAt: memberships.lastUsedAt,
      name: schools.name,
      kind: schools.kind,
      blockedAt: schools.blockedAt,
    })
    .from(memberships)
    .innerJoin(schools, eq(schools.id, memberships.schoolId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)))
    .orderBy(sql`${memberships.lastUsedAt} desc nulls last`, asc(memberships.createdAt));
}

export async function touch(userId: string, schoolId: string) {
  await db
    .update(memberships)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId)));
}

/** Добавить или вернуть членство (после прекращения) с заданными ролями. */
export async function upsert(userId: string, schoolId: string, roles: Role[], tx: Pick<typeof db, "insert"> = db) {
  await tx
    .insert(memberships)
    .values({ userId, schoolId, roles })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.schoolId],
      set: { roles, removedAt: null },
    });
}

export async function setRoles(userId: string, schoolId: string, roles: Role[]) {
  await db
    .update(memberships)
    .set({ roles })
    .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId)));
}

export async function setRemoved(userId: string, schoolId: string, removed: boolean) {
  await db
    .update(memberships)
    .set({ removedAt: removed ? new Date() : null })
    .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId)));
}

export async function listBySchool(schoolId: string) {
  return db.select().from(memberships).where(eq(memberships.schoolId, schoolId)).orderBy(desc(memberships.createdAt));
}

export async function countAllForUser(userId: string): Promise<number> {
  const rows = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId));
  return rows.length;
}

/**
 * Э15.2: принятое приглашение добавляет роль к действующему членству
 * (учитель + методист); прекращённое членство возвращается с этой ролью.
 */
export async function grantRole(userId: string, schoolId: string, role: Role): Promise<Role[]> {
  const [row] = await db
    .insert(memberships)
    .values({ userId, schoolId, roles: [role] })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.schoolId],
      set: {
        roles: sql`case when ${memberships.removedAt} is null
          then (select array_agg(distinct r) from unnest(${memberships.roles} || array[${role}]::role[]) r)
          else array[${role}]::role[] end`,
        removedAt: null,
      },
    })
    .returning({ roles: memberships.roles });
  return row!.roles;
}

/** Э15.6: действующие участники с ролью — для лимитов тарифа. */
export async function activeUserIdsWithRole(schoolId: string, role: Role): Promise<string[]> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.schoolId, schoolId), isNull(memberships.removedAt), sql`${role}::role = ANY(${memberships.roles})`));
  return rows.map((r) => r.userId);
}
