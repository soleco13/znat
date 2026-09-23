import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Link2Off } from "lucide-react";

import { ApiError } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { verifyEmail } from "./registration-api.js";

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
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg text-center">
        {error ? (
          <>
            <span className="mx-auto mb-3.5 flex size-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Link2Off className="size-7" aria-hidden />
            </span>
            <h1 className="text-[22px] font-heavy tracking-tight">Ссылка недействительна</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-5 text-sm text-muted-foreground">
              <Link to="/register" className="font-medium text-primary hover:underline">
                Зарегистрироваться заново
              </Link>
            </p>
          </>
        ) : (
          <CenteredSpinner label="Подтверждаем почту…" />
        )}
      </div>
    </div>
  );
}
