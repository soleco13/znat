import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { AuthHeading, AuthLayout, StepsAside, stagger } from "../auth/AuthLayout.js";

import { ResendVerificationButton } from "./ResendVerificationButton.js";

/** Э14.1 — экран после успешной self-signup регистрации: письмо отправлено, ждём подтверждения. */
export function EmailSentPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <AuthLayout aside={<StepsAside current={1} />}>
      {/* Конверт: контур и «галочка» прорисовываются */}
      <svg viewBox="0 0 120 88" className="auth-pop mb-7 h-[88px] w-[120px] overflow-visible" style={stagger(100)} aria-hidden>
        <rect x="4" y="12" width="112" height="72" rx="14" fill="#eff4ff" stroke="#1d4ed8" strokeWidth="3" />
        <path
          className="auth-ink"
          style={{ ["--len" as string]: 140, ["--d" as string]: "500ms" } as React.CSSProperties}
          d="M10 22 L60 58 L110 22"
          fill="none"
          stroke="#1d4ed8"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="104" cy="14" r="14" fill="#16a34a" className="auth-pop" style={stagger(1100)} />
        <path
          className="auth-ink"
          style={{ ["--len" as string]: 30, ["--d" as string]: "1300ms", ["--dur" as string]: "0.4s" } as React.CSSProperties}
          d="M97 14 L102 19 L111 9"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

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
          className="group inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-1" aria-hidden />
          Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  );
}
