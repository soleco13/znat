import { Link } from "react-router-dom";
import { ArrowRight, Building2, User } from "lucide-react";

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

      <div className="flex flex-col gap-3.5">
        {OPTIONS.map((o, i) => (
          <Link
            key={o.to}
            to={o.to}
            className="auth-rise group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-xs transition-[transform,box-shadow,border-color] duration-300 [transition-timing-function:var(--ease)] hover:-translate-y-0.5 hover:border-primary-muted hover:shadow-md active:translate-y-0 active:scale-[0.99]"
            style={stagger(240 + i * 120)}
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
              <o.icon className="size-[22px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16.5px] font-bold tracking-[-.01em]">{o.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{o.text}</span>
            </span>
            <ArrowRight
              className="size-5 shrink-0 text-text-3 transition-[transform,color] duration-300 [transition-timing-function:var(--ease)] group-hover:translate-x-1 group-hover:text-primary"
              aria-hidden
            />
          </Link>
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
