import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Link2Off } from "lucide-react";

import { ApiError } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { AuthHeading, AuthLayout, StepsAside, stagger } from "../auth/AuthLayout.js";
import { verifyEmail } from "./registration-api.js";
import { Loader } from "@/shared/ui/loader";

/** Э14.1 — подтверждение почты по ссылке из письма (`/verify-email?token=...`), затем автологин. */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Ссылка подтверждения повреждена — не найден токен");
      return;
    }
    let cancelled = false;
    verifyEmail(token)
      .then((res) => {
        if (cancelled) return;
        setAuth(res.accessToken, res.user);
        navigate("/", { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Не удалось подтвердить почту");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthLayout aside={<StepsAside current={1} />}>
      {error ? (
        <>
          <span className="auth-rise mb-6 flex size-12 items-center justify-center rounded-md border border-border text-destructive" style={stagger(0)}>
            <Link2Off className="size-6" aria-hidden />
          </span>
          <AuthHeading title="Ссылка не работает" subtitle={error} />
          <p className="auth-rise text-[14.5px]" style={stagger(300)}>
            <Link to="/register" className="font-semibold text-primary underline-offset-4 hover:underline">
              Зарегистрироваться заново
            </Link>
          </p>
        </>
      ) : (
        <>
          <span className="auth-rise mb-6 flex size-12 items-center justify-center rounded-md border border-border text-foreground" style={stagger(0)} role="status" aria-label="Подтверждаем почту">
            <Loader className="size-6 text-primary" />
          </span>
          <AuthHeading title="Подтверждаем почту" subtitle="Обычно это занимает пару секунд." />
        </>
      )}
    </AuthLayout>
  );
}
