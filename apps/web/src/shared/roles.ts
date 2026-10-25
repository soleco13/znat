import type { MeResponse, Role } from "@school/shared";

/** Э15.1: роли в выбранном пространстве набором; у старых ответов — единственная `role`. */
export function rolesOf(user: Pick<MeResponse, "role" | "roles"> | null | undefined): Role[] {
  if (!user) return [];
  return user.roles?.length ? user.roles : [user.role];
}

/** Э15.3: создавать и править материалы школы может админ или методист (в т. ч. учитель-методист). */
export function canAuthorMaterials(user: Pick<MeResponse, "role" | "roles"> | null | undefined): boolean {
  const r = rolesOf(user);
  return r.includes("admin") || r.includes("methodist");
}
