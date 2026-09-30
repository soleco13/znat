import { Link } from "react-router-dom";
import { Building2, ChevronRight, User } from "lucide-react";

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
        {OPTIONS.map((o, i) => (
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

      <p className="auth-rise mt-7 text-[14.5px] text-muted-foreground" style={stagger(520)}>
        Уже есть аккаунт?{" "}
        <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
          Войти
        </Link>
      </p>
    </AuthLayout>
  );
}
