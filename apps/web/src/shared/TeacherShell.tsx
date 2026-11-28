import { useLayoutEffect, type ReactNode } from "react";
import { Link, NavLink, useMatch } from "react-router-dom";
import { CalendarDays, Library, PlayCircle, CreditCard, SquarePen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useBillingAccess } from "./billing-access.js";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/shared/auth-store";
import { UserAvatar } from "@/shared/ui/avatar";
import { markRoleOf } from "@/shared/ui/role-mark";
import { SimpleTooltip, TooltipProvider } from "@/shared/ui/tooltip";
import { BrandMark } from "@/shared/ui/brand-mark";

/**
 * Каркас кабинета учителя (макет «ЛК учителя»). У админа и методиста —
 * прежний `AppShell`; этот только для роли `teacher` (выбор — в App.tsx).
 *
 * Десктоп — боковая панель, планшет (md–lg) — полоса иконок, телефон —
 * верхняя панель + нижние вкладки. Размеры свои, а `--header-h` задан
 * локально на корне: от него считают sticky-отступ страницы внутри
 * (редактор материала), а верхняя панель здесь есть только на телефоне.
 *
 * Масштаб: кабинет учителя крупнее остального приложения на 20% (решение
 * пользователя, 2026-09-30). `zoom` ставим на <html>, а не на корень
 * каркаса, — иначе меню и диалоги (Radix-порталы в <body>) остались бы
 * прежнего размера. Снимаем при уходе из кабинета (комната урока и т.п.).
 */
const TEACHER_ZOOM = "1.2";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Активна только при точном совпадении пути («Библиотека» vs лист материала). */
  end?: boolean;
}

const BILLING_ITEM: NavItem = { to: "/billing", label: "Тариф", icon: CreditCard };
const EDITOR_ITEM: NavItem = { to: "/materials/edit", label: "Редактор", icon: SquarePen };

const NAV: NavItem[] = [
  { to: "/lessons", label: "Уроки", icon: CalendarDays },
  { to: "/recordings", label: "Записи", icon: PlayCircle },
  { to: "/materials", label: "Библиотека", icon: Library, end: true },
];

/**
 * Пункт боковой панели. Активность — через `useMatch`, а не функцию
 * `className` у NavLink: подсказка (Radix Slot) склеивает className строкой.
 */
function SidebarLink({ item: { to, label, icon: Icon, end } }: { item: NavItem }) {
  const active = useMatch({ path: to, end: end ?? false }) !== null;
  return (
    <SimpleTooltip content={label} side="right" className="lg:hidden">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-[46px] items-center justify-center gap-3 rounded-md text-[14.5px] font-medium transition-colors duration-150 ease-ds lg:h-[42px] lg:justify-start lg:px-3",
          active ? "bg-accent font-semibold text-primary" : "text-text-2 hover:bg-secondary hover:text-foreground",
        )}
      >
        <Icon className="size-[19px] shrink-0" aria-hidden />
        <span className="sr-only lg:not-sr-only lg:truncate">{label}</span>
      </Link>
    </SimpleTooltip>
  );
}

export function TeacherShell({ children }: { children: ReactNode }) {
  // «Тариф» — только репетитору в своём личном пространстве (решает сервер).
  const billing = useBillingAccess(true);
  // Э15.1: учитель, который ещё и методист в этом пространстве, видит редактор материалов.
  const methodist = useAuthStore((s) => s.user?.roles?.includes("methodist") ?? false);
  const nav = [...NAV, ...(methodist ? [EDITOR_ITEM] : []), ...(billing ? [BILLING_ITEM] : [])];
  const user = useAuthStore((s) => s.user);
  const accountActive = useMatch({ path: "/account", end: false }) !== null;

  useLayoutEffect(() => {
    const html = document.documentElement;
    const prev = html.style.zoom;
    html.style.zoom = TEACHER_ZOOM;
    // Метка для index.css: там всплывающие окна Radix компенсируют zoom.
    html.setAttribute("data-teacher-zoom", "");
    return () => {
      html.style.zoom = prev;
      html.removeAttribute("data-teacher-zoom");
    };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      {/* Высота экрана делится на zoom: под zoom единицы dvh тоже растут. */}
      <div className="min-h-[calc(100dvh/1.2)] bg-background [--header-h:56px] md:[--header-h:0px]">
        {/* Боковая панель: полоса иконок (md) → полная (lg) */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col border-r border-border bg-card md:flex lg:w-[248px]">
          <Link
            to="/"
            className="flex h-[72px] shrink-0 items-center justify-center gap-2.5 lg:justify-start lg:px-[22px]"
          >
            <BrandMark className="size-7 text-primary" />
            <span className="hidden text-xl font-bold tracking-[-0.03em] text-foreground lg:inline">Матис</span>
          </Link>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
            {nav.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </nav>
          {user ? (
            <div className="shrink-0 border-t border-border p-3">
              <SimpleTooltip content="Личный кабинет" side="right" className="lg:hidden">
                <Link
                  to="/account"
                  aria-label={`Личный кабинет — ${user.fullName}`}
                  aria-current={accountActive ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center justify-center gap-2.5 rounded-md p-1.5 text-left transition-colors duration-150 ease-ds lg:justify-start",
                    accountActive ? "bg-accent" : "hover:bg-secondary",
                  )}
                >
                  <UserAvatar colorKey={user.id} role={markRoleOf("staff", user.role)} size={36} />
                  <span className="hidden min-w-0 flex-1 flex-col leading-tight lg:flex">
                    <span className="truncate text-sm font-semibold text-foreground">{user.fullName}</span>
                    <span className="text-xs text-muted-foreground">Учитель</span>
                  </span>
                </Link>
              </SimpleTooltip>
            </div>
          ) : null}
        </aside>

        {/* Телефон: верхняя панель */}
        <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2.5 border-b border-border bg-card px-4 md:hidden">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-[-0.03em] text-foreground">Матис</span>
          </Link>
          <span className="flex-1" />
          {user ? (
            <Link to="/account" className="rounded-full" aria-label="Личный кабинет">
              <UserAvatar colorKey={user.id} role={markRoleOf("staff", user.role)} size={34} />
            </Link>
          ) : null}
        </header>

        {/* Телефон: нижние вкладки */}
        <nav
          aria-label="Разделы"
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-16 flex-1 flex-col items-center justify-center gap-[3px] text-[11.5px] font-semibold transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <Icon className="size-[22px]" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] pt-14 md:pb-0 md:pl-[76px] md:pt-0 lg:pl-[248px]">
          <div className="mx-auto w-full max-w-[1240px] px-4 pb-10 pt-5 sm:px-7 sm:pt-8 lg:px-12 lg:pb-[72px] lg:pt-10">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
