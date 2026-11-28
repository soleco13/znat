import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, LogOut } from "lucide-react";
import { BILLING_PLANS, type Role } from "@school/shared";

import { cn } from "@/lib/utils";
import { apiFetch } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { useBillingAccess } from "@/shared/billing-access";
import { rolesLabel, spaceLabel, switchSpace, useSpaces } from "@/shared/SpaceSwitcher";
import { useSupportContacts } from "@/shared/SupportContacts";
import { RoleMark, markRoleOf, tintOf } from "@/shared/ui/role-mark";
import { getBillingState } from "@/features/billing/billing-api";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Администратор",
  methodist: "Методист",
  teacher: "Учитель",
};

const tile = "rounded-[28px] bg-card p-6 sm:p-8";
const tileLabel = "text-sm font-semibold text-muted-foreground";
const arrowDot = "flex size-11 shrink-0 items-center justify-center rounded-full";

/** Имя — первой строкой, остальное (фамилия, отчество) — второй, как в макете «ЛК». */
function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

/** Название тарифа для плитки — та же логика, что на странице «Тариф». */
function usePlanName(enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getBillingState().then(
      (s) => {
        const plan = BILLING_PLANS.find((p) => p.id === s.plan);
        if (alive) setName(plan && s.paidUntil ? plan.name : "Старт");
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [enabled]);
  return name;
}

/**
 * Личный кабинет (макет «ЛК»): аватар, имя, тариф, пароль, пространства,
 * поддержка и выход. Открывается по имени в боковой панели вместо меню.
 * Аватар — цвет и знак «Матиса» по роли, свой загрузить нельзя (решение
 * владельца 2026-11-28). Имя здесь не меняется: у сервера нет такой функции.
 */
export function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const billing = useBillingAccess(true);
  const planName = usePlanName(billing);
  const spaces = useSpaces();
  const contacts = useSupportContacts();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    document.title = "Личный кабинет — Матис";
  }, []);

  if (!user) return null;
  const [first, rest] = splitName(user.fullName);
  const tint = tintOf(user.id);

  async function logout() {
    setLeaving(true);
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    clearAuth();
    navigate("/login");
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] animate-fade-in">
      <div
        className={cn(
          "grid gap-3 sm:gap-4",
          // Телефон — столбик; планшет — две колонки; от lg — сетка макета в три колонки.
          "grid-cols-1 [grid-template-areas:'p'_'n'_'t'_'w'_'s']",
          "sm:grid-cols-2 sm:[grid-template-areas:'p_n'_'t_w'_'s_s']",
          "lg:grid-cols-3 lg:[grid-template-areas:'p_n_n'_'p_t_w'_'s_s_s']",
          !billing &&
            "[grid-template-areas:'p'_'n'_'w'_'s'] sm:[grid-template-areas:'p_n'_'w_w'_'s_s'] lg:[grid-template-areas:'p_n_n'_'p_w_w'_'s_s_s']",
        )}
      >
        {/* Аватар */}
        <div
          className="flex aspect-[4/3] items-center justify-center rounded-[28px] [grid-area:p] sm:aspect-auto sm:min-h-[260px] lg:min-h-[440px]"
          style={{ backgroundColor: tint.bg, color: tint.fg }}
        >
          <span aria-hidden>
            <RoleMark role={markRoleOf("staff", user.role)} disc={150} />
          </span>
        </div>

        {/* Имя */}
        <section className={cn(tile, "flex min-h-[200px] min-w-0 flex-col justify-between gap-8 [grid-area:n]")}>
          <span className={tileLabel}>{ROLE_LABEL[user.role]}</span>
          <div className="min-w-0">
            <h1 className="break-words font-display text-[40px] font-extrabold leading-[0.98] tracking-[-0.045em] text-foreground lg:text-[52px]">
              {first}
              {rest ? <span className="block text-muted-foreground/70">{rest}</span> : null}
            </h1>
            <p className="mt-4 truncate text-[15px] text-muted-foreground">{user.email}</p>
          </div>
        </section>

        {/* Тариф */}
        {billing ? (
          <Link
            to="/billing"
            className="flex min-h-[140px] min-w-0 flex-col justify-between gap-6 rounded-[28px] bg-primary p-6 text-white transition-colors hover:bg-primary-hover sm:min-h-[200px] sm:p-8 [grid-area:t]"
          >
            <span className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white/70">Тариф</span>
              <span className={cn(arrowDot, "bg-white/15")}>
                <ArrowUpRight className="size-5" aria-hidden />
              </span>
            </span>
            <span className="font-display text-[28px] font-extrabold leading-none tracking-[-0.04em] lg:text-[34px]">
              {planName ?? "…"}
            </span>
          </Link>
        ) : null}

        {/* Пароль */}
        <Link
          to="/account/password"
          className={cn(tile, "flex min-h-[140px] min-w-0 sm:min-h-[200px] flex-col justify-between gap-6 transition-colors hover:bg-secondary [grid-area:w]")}
        >
          <span className="flex items-center justify-between">
            <span className={tileLabel}>Пароль</span>
            <span className={cn(arrowDot, "bg-secondary text-foreground")}>
              <ArrowRight className="size-5" aria-hidden />
            </span>
          </span>
          <span className="flex flex-col gap-2">
            <span aria-hidden className="flex h-6 items-center gap-2">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="size-2.5 rounded-full bg-foreground" />
              ))}
            </span>
            <span className="font-display text-xl font-extrabold tracking-[-0.03em] text-foreground">Сменить</span>
          </span>
        </Link>

        {/* Поддержка */}
        <a
          href={contacts.telegramUrl}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col items-start justify-between gap-5 rounded-[28px] bg-foreground p-6 text-white sm:p-8 lg:min-h-[140px] lg:flex-row lg:items-center [grid-area:s]"
        >
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.04em] sm:text-[32px]">
              Поддержка
            </span>
            <span className="text-[15px] text-white/60">
              {contacts.telegram} в Telegram{contacts.email ? ` · ${contacts.email}` : ""}
            </span>
          </span>
          <span className="flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-white px-6 text-[15px] font-semibold text-foreground">
            Написать
            <ArrowUpRight className="size-[18px]" aria-hidden />
          </span>
        </a>
      </div>

      {/* Пространства — было в меню аккаунта; показываем, только если их несколько */}
      {spaces.length > 1 ? (
        <section aria-labelledby="spaces-title" className={cn(tile, "mt-3 sm:mt-4")}>
          <h2 id="spaces-title" className={tileLabel}>
            Пространства
          </h2>
          <ul className="mt-4 flex flex-col gap-2">
            {spaces.map((s) => (
              <li key={s.schoolId}>
                <button
                  type="button"
                  disabled={s.active}
                  onClick={() => void switchSpace(s.schoolId)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-secondary px-4 py-3 text-left transition-colors enabled:hover:bg-accent disabled:cursor-default"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="break-words text-[15px] font-semibold text-foreground">{spaceLabel(s)}</span>
                    <span className="truncate text-sm text-muted-foreground">{rolesLabel(s.roles)}</span>
                  </span>
                  {s.active ? (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                      <Check className="size-4" aria-hidden />
                      Открыто
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-foreground">Перейти</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 flex justify-center sm:justify-end">
        <button
          type="button"
          onClick={() => void logout()}
          disabled={leaving}
          className="flex h-11 items-center gap-2.5 rounded-full px-5 text-[14.5px] font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-destructive disabled:opacity-60"
        >
          <LogOut className="size-[18px]" aria-hidden />
          Выйти
        </button>
      </div>
    </div>
  );
}
