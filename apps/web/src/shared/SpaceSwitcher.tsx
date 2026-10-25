import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { MeResponse, Role, Space } from "@school/shared";

import { cn } from "@/lib/utils";
import { apiFetch } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { notify } from "@/shared/ui/notify";

/**
 * Э15.1 — переключатель пространств (docs/roles): личный кабинет репетитора
 * и школы, где пользователь состоит. Права в выбранном пространстве выдаёт
 * сервер (`/auth/switch`); после смены страница перезагружается, чтобы ни
 * один кеш прежнего пространства не пережил переключение.
 */
const ROLE: Record<Role, string> = { admin: "администратор", teacher: "учитель", methodist: "методист" };
export const rolesLabel = (roles: Role[]) => roles.map((r) => ROLE[r]).join(" и ");
const spaceLabel = (s: Space) => (s.kind === "individual" ? "Личный кабинет" : s.name);

export function useSpaces(): Space[] {
  const key = useAuthStore((s) => (s.user ? `${s.user.id}:${s.user.schoolId}` : null));
  const [spaces, setSpaces] = useState<Space[]>([]);
  useEffect(() => {
    setSpaces([]);
    if (!key) return;
    let alive = true;
    apiFetch<Space[]>("/auth/spaces").then(
      (r) => alive && setSpaces(r),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return spaces;
}

export async function switchSpace(schoolId: string): Promise<void> {
  try {
    const r = await apiFetch<{ accessToken: string; user: MeResponse }>("/auth/switch", {
      method: "POST",
      body: JSON.stringify({ schoolId }),
    });
    useAuthStore.getState().setAuth(r.accessToken, r.user);
    window.location.assign("/");
  } catch (e) {
    notify.error(e instanceof Error ? e.message : "Не удалось переключить пространство");
  }
}

/** Пункты пространств — внутри меню аккаунта (кабинет учителя). */
export function SpaceMenuItems({ spaces }: { spaces: Space[] }) {
  if (spaces.length < 2) return null;
  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Пространства</DropdownMenuLabel>
      {spaces.map((s) => (
        <DropdownMenuItem key={s.schoolId} onSelect={() => !s.active && void switchSpace(s.schoolId)}>
          <Check aria-hidden className={cn(!s.active && "invisible")} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{spaceLabel(s)}</span>
            <span className="truncate text-xs text-muted-foreground">{rolesLabel(s.roles)}</span>
          </span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}

/** Кнопка в шапке (кабинет администратора и методиста). */
export function SpaceSwitcher() {
  const spaces = useSpaces();
  if (spaces.length < 2) return null;
  const current = spaces.find((s) => s.active);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex max-w-[16rem] items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
          aria-label="Сменить пространство"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{current ? spaceLabel(current) : "Пространство"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <SpaceMenuItems spaces={spaces} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
