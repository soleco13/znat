import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import type { Role } from "@school/shared";

import { useAuthStore } from "./auth-store.js";

/** Куда отправить роль, если её не пускают на страницу (§4.2 ТЗ). */
function homeFor(role: Role | undefined): string {
  if (role === "methodist") return "/materials";
  return "/lessons";
}

/**
 * Ограничение страницы по роли. `RequireAuth` уже проверил вход — здесь
 * только роль. Не подходящую роль уводим на её домашнюю страницу, а не на
 * /login (человек залогинен, просто не сюда).
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (role && !roles.includes(role)) {
    return <Navigate to={homeFor(role)} replace />;
  }
  return <>{children}</>;
}

/** `/` → домашняя страница роли: методист → библиотека, остальные → уроки. */
export function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  return <Navigate to={homeFor(role)} replace />;
}
