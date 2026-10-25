import { eq, and, ilike, or, count, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { memberships, users } from "../../db/schema.js";
import { primaryRole } from "../../plugins/roles.js";
import type { Role } from "@school/shared";

/**
 * Э15.1: принадлежность к школе и роль — из членства (`memberships`), не из
 * `users.school_id/role` (там домашнее пространство до полного перехода).
 * Таблица членства — общая с модулем `memberships`: состав школы — это и
 * есть членство, отдельный сервис для каждой выборки только дробил бы join.
 */
type UserRow = typeof users.$inferSelect;
type MemberRow = UserRow & { roles: Role[] };

function inSchool(row: UserRow, m: { schoolId: string; roles: Role[]; removedAt: Date | null }): MemberRow {
  return {
    ...row,
    schoolId: m.schoolId,
    role: primaryRole(m.roles),
    roles: m.roles,
    // Отключение в школе = прекращённое членство; глобальное `is_active` — блокировка аккаунта.
    isActive: row.isActive && m.removedAt === null,
  };
}

const memberCols = { schoolId: memberships.schoolId, roles: memberships.roles, removedAt: memberships.removedAt };

export async function insertUser(input: {
  schoolId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  emailVerifiedAt?: Date;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(users).values(input).returning();
    await tx.insert(memberships).values({ userId: row!.id, schoolId: input.schoolId, roles: [input.role] });
    return inSchool(row!, { schoolId: input.schoolId, roles: [input.role], removedAt: null });
  });
}

/**
 * Изменение участника школы с защитой от школы без администратора: если
 * правка снимает с действующего админа роль или прекращает его членство, в
 * школе должен остаться другой действующий админ. Advisory-lock на школу —
 * два админа, одновременно разжалующие друг друга, не оставят школу пустой.
 * Роль и «отключение» относятся к членству в этой школе, имя — к аккаунту.
 */
export async function updateUser(
  id: string,
  schoolId: string,
  patch: Partial<{ fullName: string; role: Role; roles: Role[]; isActive: boolean }>,
): Promise<{ row: MemberRow } | { row: null } | { lastAdmin: true }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${schoolId}))`);
    const [current] = await tx
      .select({ user: users, ...memberCols })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.schoolId, schoolId)))
      .where(eq(users.id, id))
      .limit(1);
    if (!current) return { row: null };
    const isAdminNow = current.roles.includes("admin") && current.removedAt === null && current.user.isActive;
    const nextRoles = patch.roles ?? (patch.role !== undefined ? [patch.role] : null);
    const losesAdmin = isAdminNow && ((nextRoles !== null && !nextRoles.includes("admin")) || patch.isActive === false);
    if (losesAdmin) {
      const [other] = await tx
        .select({ n: count() })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.schoolId, schoolId),
            isNull(memberships.removedAt),
            sql`'admin' = ANY(${memberships.roles})`,
            eq(users.isActive, true),
            ne(memberships.userId, id),
          ),
        );
      if ((other?.n ?? 0) === 0) return { lastAdmin: true as const };
    }
    let roles = current.roles;
    let removedAt = current.removedAt;
    if (nextRoles !== null || patch.isActive !== undefined) {
      if (nextRoles !== null) roles = [...new Set(nextRoles)];
      if (patch.isActive !== undefined) removedAt = patch.isActive ? null : new Date();
      await tx
        .update(memberships)
        .set({ roles, removedAt })
        .where(and(eq(memberships.userId, id), eq(memberships.schoolId, schoolId)));
      // Домашнее пространство — держим `users.role` в согласии до полного перехода.
      if (nextRoles !== null && current.user.schoolId === schoolId) {
        await tx.update(users).set({ role: primaryRole(roles) }).where(eq(users.id, id));
      }
    }
    let user = current.user;
    if (patch.fullName !== undefined) {
      const [renamed] = await tx.update(users).set({ fullName: patch.fullName }).where(eq(users.id, id)).returning();
      user = renamed ?? user;
    }
    return { row: inSchool(user, { schoolId, roles, removedAt }) };
  });
}

/** Пользователь как участник школы (действующее членство) или null. */
export async function findUserById(id: string, schoolId: string): Promise<MemberRow | null> {
  const [row] = await db
    .select({ user: users, ...memberCols })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.schoolId, schoolId), isNull(memberships.removedAt)),
    )
    .where(eq(users.id, id))
    .limit(1);
  return row ? inSchool(row.user, row) : null;
}

/** Имена по набору id (Э12: `teacherName` в уроках, журнал посещений) — и бывших участников школы. */
export async function findUsersByIds(
  schoolId: string,
  ids: string[],
): Promise<{ id: string; fullName: string; role: Role }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, roles: memberships.roles })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.schoolId, schoolId)))
    .where(inArray(users.id, ids));
  return rows.map((r) => ({ id: r.id, fullName: r.fullName, role: primaryRole(r.roles) }));
}

export async function listUsers(input: {
  schoolId: string;
  role?: Role;
  q?: string;
  page: number;
  pageSize: number;
}) {
  const conditions = [eq(memberships.schoolId, input.schoolId)];
  if (input.role) conditions.push(sql`${input.role}::role = ANY(${memberships.roles})`);
  if (input.q) {
    conditions.push(or(ilike(users.email, `%${input.q}%`), ilike(users.fullName, `%${input.q}%`))!);
  }
  const where = and(...conditions);
  const joined = and(eq(memberships.userId, users.id), eq(memberships.schoolId, input.schoolId));

  const [rows, totalRows] = await Promise.all([
    db
      .select({ user: users, ...memberCols })
      .from(users)
      .innerJoin(memberships, joined)
      .where(where)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .orderBy(memberships.createdAt),
    db.select({ total: count() }).from(users).innerJoin(memberships, joined).where(where),
  ]);

  return { rows: rows.map((r) => inSchool(r.user, r)), total: totalRows[0]?.total ?? 0 };
}

/** Все пользователи сервиса — раздел «Платформа» супер-админа. Без хэшей паролей. */
export async function listAllUsers(input: { q?: string; schoolId?: string; limit: number }) {
  const conds = [];
  if (input.schoolId) conds.push(eq(users.schoolId, input.schoolId));
  if (input.q) conds.push(or(ilike(users.email, `%${input.q}%`), ilike(users.fullName, `%${input.q}%`)));
  return db
    .select({
      id: users.id,
      schoolId: users.schoolId,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${users.createdAt} desc`)
    .limit(input.limit);
}

export async function countUsersBySchool() {
  return db
    .select({ schoolId: memberships.schoolId, n: count() })
    .from(memberships)
    .where(isNull(memberships.removedAt))
    .groupBy(memberships.schoolId);
}

export async function findEmailsByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids));
}
