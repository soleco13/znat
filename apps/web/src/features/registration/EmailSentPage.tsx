import { Link, useLocation } from "react-router-dom";
import { MailCheck } from "lucide-react";

/** Э14.1 — экран после успешной self-signup регистрации: письмо отправлено, ждём подтверждения. */
export function EmailSentPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg text-center">
        <span className="mx-auto mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <MailCheck className="size-7" aria-hidden />
        </span>
        <h1 className="text-[22px] font-heavy tracking-tight">Проверьте почту</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Мы отправили письмо с подтверждением{email ? <> на <strong>{email}</strong></> : null}. Перейдите
          по ссылке из письма, чтобы активировать аккаунт.
        </p>
        <p className="mt-5 text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Вернуться ко входу
          </Link>
        </p>
      </div>
    </div>
  );
}
