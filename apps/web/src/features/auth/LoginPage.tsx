import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LoginRequest, MeResponse } from "@school/shared";

import { apiFetch, ApiError } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverifiedEmail(null);
    setSubmitting(true);
    try {
      const body: LoginRequest = { email, password };
      const data = await apiFetch<{ accessToken: string; user: MeResponse }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setAuth(data.accessToken, data.user);
      navigate("/lessons");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
      if (err instanceof ApiError && err.code === "email_not_verified") setUnverifiedEmail(email);
    } finally {
      setSubmitting(false);
    }
  }

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
