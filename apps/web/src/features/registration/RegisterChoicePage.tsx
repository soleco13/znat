import { Link } from "react-router-dom";
import { Building2, GraduationCap, User } from "lucide-react";

/**
 * Э14.1 — точка входа в публичную self-signup регистрацию (§ план-ТЗ Э14):
 * репетитор (физлицо, без организации) или ООО (создаёт именованное
 * пространство). Вне `AppShell`/`RequireAuth` — регистрирующийся ещё не
 * авторизован.
 */
export function RegisterChoicePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[440px] rounded-xl border border-border bg-card p-9 shadow-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-7" aria-hidden />
          </span>
          <h1 className="text-[22px] font-heavy tracking-tight">Регистрация</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Как вы будете использовать платформу?</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            to="/register/individual"
            className="flex items-center gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-accent"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <User className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block font-medium">Я репетитор</span>
              <span className="block text-sm text-muted-foreground">
                Личный кабинет для одного преподавателя
              </span>
            </span>
          </Link>

          <Link
            to="/register/organization"
            className="flex items-center gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-accent"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block font-medium">Я представляю организацию</span>
              <span className="block text-sm text-muted-foreground">
                Создать пространство школы (ООО) с учителями и уроками
              </span>
            </span>
          </Link>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Уже есть аккаунт?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
