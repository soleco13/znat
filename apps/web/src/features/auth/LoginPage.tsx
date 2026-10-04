import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { LoginRequest, MeResponse } from "@school/shared";

import { apiFetch, ApiError, hasStaffSession } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { FullscreenLoader } from "@/shared/ui/fullscreen-loader";
import { AuthHeading, AuthLayout, Field, FormError, LobbyAside, PasswordInput, authInput, stagger } from "./AuthLayout.js";
import { ResendVerificationButton } from "@/features/registration/ResendVerificationButton";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const location = useLocation();
  // Куда вернуть после входа: страница, с которой сюда отправил RequireAuth.
  const from = (location.state as { from?: string } | null)?.from;
  const target = from?.startsWith("/") && !from.startsWith("//") ? from : "/lessons";
  const [checkingSession, setCheckingSession] = useState(true);

  // Уже вошли в этом браузере (новая вкладка, закладка на /login) — форму не показываем.
  useEffect(() => {
    let cancelled = false;
    void hasStaffSession().then((ok) => {
      if (cancelled) return;
      if (ok) navigate(target, { replace: true });
      else setCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, target]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverifiedEmail(null);
    setSubmitting(true);
    try {
      const body: LoginRequest = { email, password };
      // Без повтора через /auth/refresh: 401 здесь — неверный пароль, а не протухший токен.
      const data = await apiFetch<{ accessToken: string; user: MeResponse }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify(body) },
        false,
      );
      setAuth(data.accessToken, data.user);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
      if (err instanceof ApiError && err.code === "email_not_verified") setUnverifiedEmail(email);
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) return <FullscreenLoader label="Проверяем вход…" />;

  return (
    <AuthLayout aside={<LobbyAside />}>
      <AuthHeading title="С возвращением" subtitle="Войдите, чтобы вести уроки и проверять работы." />

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field id="login-email" label="Email" delay={240}>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@school.ru"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error != null}
            className={authInput}
            autoFocus
            required
          />
        </Field>
        <Field
          id="login-password"
          label="Пароль"
          delay={320}
          aside={
            <Link to="/forgot-password" className="text-xs font-semibold text-primary underline-offset-4 hover:underline">
              Забыли пароль?
            </Link>
          }
        >
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
            invalid={error != null}
          />
        </Field>

        <FormError message={error} />
        {unverifiedEmail ? <ResendVerificationButton email={unverifiedEmail} /> : null}

        <div className="auth-rise" style={stagger(400)}>
          <Button type="submit" size="lg" className="h-12 w-full text-[16px]" loading={submitting}>
            {submitting ? "Входим…" : "Войти"}
          </Button>
        </div>
      </form>

      <p className="auth-rise mt-7 text-[14.5px] text-muted-foreground" style={stagger(480)}>
        Нет аккаунта?{" "}
        <Link to="/register" className="font-semibold text-primary underline-offset-4 hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </AuthLayout>
  );
}
