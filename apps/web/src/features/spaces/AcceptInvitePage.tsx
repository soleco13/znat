import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Link2Off } from "lucide-react";
import type { Role } from "@school/shared";

import { apiFetch, ApiError, hasStaffSession } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { switchSpace } from "@/shared/SpaceSwitcher";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { PersonalDataConsent } from "@/shared/PersonalDataConsent";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { StatusScreen } from "@/shared/ui/status-screen";
import { acceptInvite, getInvitePublicInfo } from "@/features/invites/invites-api";
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
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Э15.2: уже вошедший аккаунт (репетитор, участник другой школы) принимает
  // приглашение без регистрации — школа добавляется к его аккаунту.
  const [session, setSession] = useState<"checking" | "in" | "out">("checking");
  const me = useAuthStore((st) => st.user);
  const [accepting, setAccepting] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasStaffSession().then((ok) => alive && setSession(ok ? "in" : "out"));
    return () => {
      alive = false;
    };
  }, []);

  async function onAccept() {
    setError(null);
    setAccepting(true);
    try {
      const r = await acceptInvite(code);
      await switchSpace(r.schoolId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять приглашение");
      setAccepting(false);
    }
  }

  async function onOtherAccount() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    useAuthStore.getState().clearAuth();
    setSession("out");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await registerIndividual({ fullName, email, password, inviteCode: code, personalDataConsent: true });
      navigate("/register/check-email", { state: { email: result.email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять приглашение");
      setSubmitting(false);
    }
  }

  return (
    <StatusScreen>
        {info.loading ? (
          <CenteredSpinner label="Проверяем приглашение…" />
        ) : info.error || !info.data ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2Off aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Приглашение не найдено</EmptyTitle>
              <EmptyDescription>Проверьте ссылку — возможно, она устарела.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !info.data.valid ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2Off aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Приглашение больше не действует</EmptyTitle>
              <EmptyDescription>
                Ссылка в «{info.data.schoolName}» отозвана, просрочена или уже использована. Попросите
                администратора прислать новую.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="mb-7">
              <h1 className="text-2xl font-heavy tracking-tight">Приглашение в «{info.data.schoolName}»</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Вас приглашают в роли {ROLE_LABEL[info.data.role]}
                {info.data.forEmail ? `. Приглашение для ${info.data.forEmail}` : ""}
              </p>
            </div>
            {session === "checking" ? (
              <CenteredSpinner label="Проверяем вход…" />
            ) : session === "in" && me ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-foreground">
                  Вы вошли как <span className="font-semibold">{me.fullName}</span> ({me.email}). Школа добавится к
                  вашему аккаунту, личный кабинет и другие школы сохранятся.
                </p>
                {error ? (
                  <p className="text-sm font-medium text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button size="lg" className="w-full" loading={accepting} onClick={() => void onAccept()}>
                  Принять приглашение
                </Button>
                <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => void onOtherAccount()}>
                  Войти в другой аккаунт
                </button>
              </div>
            ) : (
            <>
            <p className="mb-5 text-sm text-muted-foreground">
              Уже есть аккаунт в Матисе?{" "}
              <Link to="/login" state={{ from: window.location.pathname }} className="font-medium text-primary hover:underline">
                Войдите
              </Link>
              , и школа добавится к нему. Если аккаунта нет, заполните форму.
            </p>
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

              <PersonalDataConsent checked={consent} onChange={setConsent} />

              {error ? (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" className="mt-1 w-full" loading={submitting} disabled={!consent}>
                {submitting ? "Присоединяемся…" : "Присоединиться"}
              </Button>
            </form>
            </>
            )}
          </>
        )}
    </StatusScreen>
  );
}
