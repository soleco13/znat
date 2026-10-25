import type { Role, Space } from "@school/shared";
import { primaryRole } from "../../plugins/roles.js";
import * as repo from "./repo.js";

/**
 * Э15.1 — членство в пространствах (docs/roles). Права пользователя в
 * запросе определяются выбранным пространством и ролями в нём; доступ в
 * пространство есть только при действующем членстве.
 */
export interface ActiveSpace {
  schoolId: string;
  roles: Role[];
  role: Role;
}

const toSpace = (schoolId: string, roles: Role[]): ActiveSpace => ({ schoolId, roles, role: primaryRole(roles) });

/** Действующее членство в пространстве или null. */
export async function getActive(userId: string, schoolId: string): Promise<ActiveSpace | null> {
  const row = await repo.findActive(userId, schoolId);
  return row && row.roles.length ? toSpace(row.schoolId, row.roles) : null;
}

/**
 * Пространство для сессии: запрошенное, если членство действует, иначе
 * последнее использованное. null — пользователь нигде не состоит.
 */
export async function resolveSpace(userId: string, preferred: string | null | undefined): Promise<ActiveSpace | null> {
  if (preferred) {
    const wanted = await getActive(userId, preferred);
    if (wanted) return wanted;
  }
  const [first] = await repo.listActiveForUser(userId);
  return first && first.roles.length ? toSpace(first.schoolId, first.roles) : null;
}

export async function listSpaces(userId: string, activeSchoolId: string): Promise<Space[]> {
  const rows = await repo.listActiveForUser(userId);
  return rows
    .filter((r) => r.roles.length)
    .map((r) => ({ schoolId: r.schoolId, name: r.name, kind: r.kind, roles: r.roles, active: r.schoolId === activeSchoolId }));
}

export const touch = repo.touch;
export const addMember = (userId: string, schoolId: string, roles: Role[]) => repo.upsert(userId, schoolId, roles);
export const setRoles = repo.setRoles;
export const setRemoved = repo.setRemoved;

/** Есть ли у пользователя записи членства вообще (включая прекращённые). */
export async function hasAnyMembership(userId: string): Promise<boolean> {
  return (await repo.countAllForUser(userId)) > 0;
}
