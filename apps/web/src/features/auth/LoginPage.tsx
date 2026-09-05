import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import type { LoginRequest, MeResponse } from "@school/shared";

import { apiFetch, ApiError } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-7" aria-hidden />
          </span>
          <h1 className="text-[22px] font-heavy tracking-tight">Школа онлайн</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Вход в платформу</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@school.ru"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error != null}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password">Пароль</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error != null}
              required
            />
          </div>

          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="mt-1 w-full" loading={submitting}>
            {submitting ? "Входим…" : "Войти"}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Используйте данные от платформы Shkola
        </p>
      </div>
    </div>
  );
}
