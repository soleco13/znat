import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Link2Off, UserPlus } from "lucide-react";
import type { Role } from "@school/shared";

import { ApiError } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { getInvitePublicInfo } from "@/features/invites/invites-api";
import { registerIndividual } from "@/features/registration/registration-api";

const ROLE_LABEL: Record<Role, string> = {
  admin: "администратора",
  methodist: "методиста",
  teacher: "учителя",
};

/**
 * Э14.2 — приём приглашения в чужое пространство (`/s/:slug/invite/:code`).
 * Показывает, в какое пространство и на какую роль приглашают, ДО того как
 * человек вводит данные — предпросмотр публичный, без аутентификации.
 */
export function AcceptInvitePage() {
  const { code = "" } = useParams<{ slug: string; code: string }>();
  const info = useAsync(() => getInvitePublicInfo(code), [code]);
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await registerIndividual({ fullName, email, password, inviteCode: code });
      navigate("/register/check-email", { state: { email: result.email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять приглашение");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg">
        {info.loading ? (
          <CenteredSpinner label="Проверяем приглашение…" />
        ) : info.error || !info.data ? (
          <div className="flex flex-col items-center text-center">
            <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Link2Off className="size-7" aria-hidden />
            </span>
            <h1 className="text-[22px] font-heavy tracking-tight">Приглашение не найдено</h1>
            <p className="mt-2 text-sm text-muted-foreground">Проверьте ссылку — возможно, она устарела.</p>
          </div>
        ) : !info.data.valid ? (
          <div className="flex flex-col items-center text-center">
            <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Link2Off className="size-7" aria-hidden />
            </span>
            <h1 className="text-[22px] font-heavy tracking-tight">Приглашение больше не действует</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ссылка в «{info.data.schoolName}» отозвана, просрочена или уже использована. Попросите
              администратора прислать новую.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-8 flex flex-col items-center text-center">
              <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <UserPlus className="size-7" aria-hidden />
              </span>
              <h1 className="text-[22px] font-heavy tracking-tight">Приглашение в «{info.data.schoolName}»</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Вас приглашают в роли {ROLE_LABEL[info.data.role]}
              </p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-name">Имя и фамилия</Label>
                <Input
                  id="invite-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-password">Пароль</Label>
                <Input
                  id="invite-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="Минимум 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error ? (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" className="mt-1 w-full" loading={submitting}>
                {submitting ? "Присоединяемся…" : "Присоединиться"}
              </Button>
            </form>
          </>
        )}

        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Уже есть аккаунт? Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
