import { Link } from "react-router-dom";
import { Building2, ChevronRight, Clock, User } from "lucide-react";
import { ORGANIZATION_SIGNUP_OPEN, SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL } from "@school/shared";

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";

import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/shared/ui/item";

import { AuthHeading, AuthLayout, StepsAside, stagger } from "../auth/AuthLayout.js";

const OPTIONS = [
  {
    to: "/register/individual",
    icon: User,
    title: "Я репетитор",
    text: "Личный кабинет для одного преподавателя",
  },
  {
    to: "/register/organization",
    icon: Building2,
    title: "Я представляю организацию",
    text: "Пространство школы (ООО) с учителями и уроками",
  },
];

/**
 * Э14.1 — точка входа в публичную self-signup регистрацию (§ план-ТЗ Э14):
 * репетитор (физлицо, без организации) или ООО (создаёт именованное
 * пространство). Вне `AppShell`/`RequireAuth` — регистрирующийся ещё не
 * авторизован.
 */
export function RegisterChoicePage() {
  return (
    <AuthLayout aside={<StepsAside current={0} />}>
      <AuthHeading title="Начнём?" subtitle="Как вы будете использовать платформу?" />

      <div className="flex flex-col gap-3">
        {(ORGANIZATION_SIGNUP_OPEN ? OPTIONS : OPTIONS.slice(0, 1)).map((o, i) => (
          <Item key={o.to} variant="outline" asChild className="auth-rise" style={stagger(240 + i * 120)}>
            <Link to={o.to}>
              <ItemMedia variant="icon">
                <o.icon aria-hidden />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="text-base">{o.title}</ItemTitle>
                <ItemDescription>{o.text}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRight className="size-5 text-text-3" aria-hidden />
              </ItemActions>
            </Link>
          </Item>
        ))}
      </div>

      {ORGANIZATION_SIGNUP_OPEN ? null : <OrganizationSignupClosed className="auth-rise mt-3" style={stagger(360)} />}

      <p className="auth-rise mt-7 text-[14.5px] text-muted-foreground" style={stagger(520)}>
        Уже есть аккаунт?{" "}
        <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
          Войти
        </Link>
      </p>
    </AuthLayout>
  );
}

/**
 * Регистрация организаций закрыта (решение владельца 2026-11-24): тарифов для
 * школ нет на сайте. Плашка вместо пункта выбора и вместо формы ООО.
 */
export function OrganizationSignupClosed({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <Alert className={className} style={style} role="status">
      <Clock aria-hidden />
      <AlertTitle>Регистрация для организаций в разработке</AlertTitle>
      <AlertDescription>
        Скоро здесь можно будет создать пространство школы с учителями и администратором. Хотите подключиться раньше —
        напишите нам в Telegram{" "}
        <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
          {SUPPORT_TELEGRAM}
        </a>
        .
      </AlertDescription>
    </Alert>
  );
}
