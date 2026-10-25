import type { AccessTokenPayload, Role } from "@school/shared";

/**
 * Э15.1: роли в пространстве — набором (учитель и методист совмещаются).
 * Основная роль выбирает каркас интерфейса и обслуживает старые проверки
 * `user.role === …`: админ > учитель > методист.
 */
export function primaryRole(roles: readonly Role[]): Role {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("teacher")) return "teacher";
  return "methodist";
}

/** Роли из токена; у токенов до Э15.1 набора нет — тогда единственная `role`. */
export function rolesOf(user: Pick<AccessTokenPayload, "role" | "roles">): Role[] {
  return user.roles && user.roles.length ? user.roles : [user.role];
}

export function hasRole(user: Pick<AccessTokenPayload, "role" | "roles">, role: Role): boolean {
  return rolesOf(user).includes(role);
}
