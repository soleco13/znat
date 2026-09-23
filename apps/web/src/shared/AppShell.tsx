import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  GraduationCap,
  HardDrive,
  Library,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquarePen,
  Ticket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@school/shared";

import { cn } from "@/lib/utils";
import { apiFetch } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { UserAvatar } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/shared/ui/sheet";
import { SimpleTooltip, TooltipProvider } from "@/shared/ui/tooltip";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  /** NavLink `end` — активна только при точном совпадении пути (см. «Библиотека» vs «Редактор»). */
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/lessons", label: "Уроки", icon: CalendarDays, roles: ["admin", "teacher"] },
  { to: "/admin/recordings", label: "Записи", icon: HardDrive, roles: ["admin"] },
  {
    to: "/materials",
    label: "Библиотека",
    icon: Library,
    roles: ["admin", "methodist", "teacher"],
    end: true,
  },
  { to: "/materials/edit", label: "Редактор", icon: SquarePen, roles: ["admin", "methodist"] },
  { to: "/admin/settings", label: "Параметры", icon: Settings, roles: ["admin"] },
  { to: "/admin/invites", label: "Приглашения", icon: Ticket, roles: ["admin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  admin: "Администратор",
  methodist: "Методист",
  teacher: "Учитель",
};

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="size-[18px]" aria-hidden />
      </span>
      {!compact && (
        <span className="truncate text-[17px] font-heavy tracking-tight text-foreground">
          Школа <span className="text-primary">онлайн</span>
        </span>
      )}
    </Link>
  );
}

function NavItems({ role, onNavigate }: { role: Role | null; onNavigate?: () => void }) {
  const items = role ? NAV.filter((n) => n.roles.includes(role)) : [];
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium transition-colors",
              isActive
                ? "bg-accent font-semibold text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )
          }
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarContent({
  role,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  role: Role | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  if (collapsed) {
    const items = role ? NAV.filter((n) => n.roles.includes(role)) : [];
    return (
      <div className="flex h-full flex-col items-center">
        <div className="flex h-header w-full items-center justify-center border-b border-border">
          <Wordmark compact />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2.5">
          {items.map(({ to, label, icon: Icon, end }) => (
            <SimpleTooltip key={to} content={label} side="right">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex size-11 items-center justify-center rounded-md transition-colors",
                    isActive
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                <span className="sr-only">{label}</span>
              </NavLink>
            </SimpleTooltip>
          ))}
        </nav>
        <div className="w-full border-t border-border p-2.5">
          <SimpleTooltip content="Развернуть меню" side="right">
            <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Развернуть меню">
              <PanelLeftOpen />
            </Button>
          </SimpleTooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-header items-center border-b border-border px-5">
        <Wordmark />
      </div>
      <NavItems role={role} onNavigate={onNavigate} />
      {onToggleCollapse ? (
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <PanelLeftClose className="size-5" aria-hidden />
            Свернуть
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Э12.9: роли `student` больше нет — до подгрузки профиля показываем
  // оболочку без пунктов навигации, а не «как ученику».
  const role: Role | null = user?.role ?? null;

  async function logout() {
    setLoggingOut(true);
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    clearAuth();
    navigate("/login");
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh bg-background">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 hidden border-r border-border bg-card transition-[width] duration-200 ease-ds lg:block",
            collapsed ? "w-sidebar-collapsed" : "w-sidebar",
          )}
        >
          <SidebarContent
            role={role}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((v) => !v)}
          />
        </aside>

        {/* Header */}
        <header
          className={cn(
            "fixed inset-x-0 top-0 z-30 flex h-header items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md transition-[left] duration-200 ease-ds sm:px-6",
            collapsed ? "lg:left-sidebar-collapsed" : "lg:left-sidebar",
          )}
        >
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Меню">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SidebarContent role={role} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="lg:hidden">
            <Wordmark compact />
          </div>

          <div className="flex-1" />

          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-semibold text-foreground">{user.fullName}</div>
                <div className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</div>
              </div>
              <UserAvatar name={user.fullName} size={38} />
              <SimpleTooltip content="Выйти">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  loading={loggingOut}
                  aria-label="Выйти"
                >
                  <LogOut />
                </Button>
              </SimpleTooltip>
            </div>
          ) : null}
        </header>

        {/* Content */}
        <main
          className={cn(
            "pt-header transition-[padding] duration-200 ease-ds",
            collapsed ? "lg:pl-sidebar-collapsed" : "lg:pl-sidebar",
          )}
        >
          <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
