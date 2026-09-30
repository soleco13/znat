import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, MailCheck } from "lucide-react";

import { AuthHeading, AuthLayout, StepsAside, stagger } from "../auth/AuthLayout.js";

import { ResendVerificationButton } from "./ResendVerificationButton.js";

/** Э14.1 — экран после успешной self-signup регистрации: письмо отправлено, ждём подтверждения. */
export function EmailSentPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <AuthLayout aside={<StepsAside current={1} />}>
      <span className="auth-rise mb-6 flex size-12 items-center justify-center rounded-md border border-border text-foreground" style={stagger(0)}>
        <MailCheck className="size-6" aria-hidden />
      </span>

      <AuthHeading
        title="Проверьте почту"
        subtitle={
          <>
            Мы отправили письмо с подтверждением{email ? <> на <strong className="text-foreground">{email}</strong></> : null}.
            Перейдите по ссылке из письма, чтобы активировать аккаунт.
          </>
        }
      />

      <p className="auth-rise text-sm text-muted-foreground" style={stagger(300)}>
        Письма нет? Загляните в «Спам» — иногда оно попадает туда.
      </p>

      {email ? (
        <div className="auth-rise mt-4 [&>div]:items-start" style={stagger(340)}>
          <ResendVerificationButton email={email} />
        </div>
      ) : null}

      <p className="auth-rise mt-7 text-[14.5px]" style={stagger(380)}>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  );
}
