import { Navigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import type { Role, Space } from "@school/shared";

import { apiFetch } from "./api-client.js";
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
  // Э15.1: подходит любая роль из набора в выбранном пространстве.
  const mine = useAuthStore((s) => s.user?.roles);
  const set = mine?.length ? mine : role ? [role] : [];
  if (role && !set.some((r) => roles.includes(r))) {
    return <Navigate to={homeFor(role)} replace />;
  }
  return <>{children}</>;
}

/** `/` → домашняя страница роли: методист → библиотека, остальные → уроки. */
export function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  // Пространство «Матис» (`kind: platform`) — не школа: уроков и тарифа там нет.
  // Супер-админ попадает в «Платформу», команда Матиса — в библиотеку.
  const [kind, setKind] = useState<string | null | undefined>(role === "admin" || role === "methodist" ? undefined : null);
  useEffect(() => {
    if (kind !== undefined) return;
    let alive = true;
    apiFetch<Space[]>("/auth/spaces").then(
      (r) => alive && setKind(r.find((s) => s.active)?.kind ?? null),
      () => alive && setKind(null),
    );
    return () => {
      alive = false;
    };
  }, [kind]);
  if (kind === undefined) return null;
  if (kind === "platform") return <Navigate to={role === "admin" ? "/platform" : "/materials"} replace />;
  return <Navigate to={homeFor(role)} replace />;
}
