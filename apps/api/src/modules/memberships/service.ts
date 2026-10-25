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

/**
 * Действующее членство в пространстве или null. Э15.4: заблокированное
 * пространство для участников закрыто (`includeBlocked` — только супер-админу).
 */
export async function getActive(userId: string, schoolId: string, includeBlocked = false): Promise<ActiveSpace | null> {
  const row = await repo.findActive(userId, schoolId);
  if (!row || !row.roles.length || (row.blockedAt && !includeBlocked)) return null;
  return toSpace(row.schoolId, row.roles);
}

/** Э15.4: супер-админ входит в любое существующее пространство администратором. */
export async function superAdminSpace(schoolId: string): Promise<ActiveSpace | null> {
  const school = await repo.findSchool(schoolId);
  return school ? toSpace(school.id, ["admin"]) : null;
}

/**
 * Пространство для сессии: запрошенное, если членство действует, иначе
 * последнее использованное. null — пользователь нигде не состоит.
 */
export async function resolveSpace(
  userId: string,
  preferred: string | null | undefined,
  superAdmin = false,
): Promise<ActiveSpace | null> {
  if (preferred) {
    const wanted = (await getActive(userId, preferred, superAdmin)) ?? (superAdmin ? await superAdminSpace(preferred) : null);
    if (wanted) return wanted;
  }
  const rows = await repo.listActiveForUser(userId);
  const first = rows.find((r) => r.roles.length && (superAdmin || !r.blockedAt));
  return first ? toSpace(first.schoolId, first.roles) : null;
}

export async function listSpaces(userId: string, activeSchoolId: string, superAdmin = false): Promise<Space[]> {
  const rows = await repo.listActiveForUser(userId);
  const spaces = rows
    .filter((r) => r.roles.length && (superAdmin || !r.blockedAt))
    .map((r) => ({ schoolId: r.schoolId, name: r.name, kind: r.kind, roles: r.roles, active: r.schoolId === activeSchoolId }));
  // Супер-админ открыл чужое пространство — оно тоже в списке, чтобы было видно, где он сейчас.
  if (superAdmin && !spaces.some((s) => s.active)) {
    const school = await repo.findSchool(activeSchoolId);
    if (school) spaces.unshift({ schoolId: school.id, name: school.name, kind: school.kind, roles: ["admin"], active: true });
  }
  return spaces;
}

export const touch = repo.touch;
export const addMember = (userId: string, schoolId: string, roles: Role[]) => repo.upsert(userId, schoolId, roles);
export const setRoles = repo.setRoles;
export const setRemoved = repo.setRemoved;

/** Есть ли у пользователя записи членства вообще (включая прекращённые). */
export async function hasAnyMembership(userId: string): Promise<boolean> {
  return (await repo.countAllForUser(userId)) > 0;
}

export const grantRole = repo.grantRole;
