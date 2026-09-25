import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { resetPassword } from "./account-api.js";
import { AuthCard } from "./AuthCard.js";

/** Новый пароль по ссылке из письма (`/reset-password?token=...`). */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Пароль — не короче 8 символов");
    if (password !== repeat) return setError("Пароли не совпадают");
    setSubmitting(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сменить пароль");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Ссылка повреждена" subtitle="В ссылке нет токена — запросите новую.">
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Запросить ссылку
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Новый пароль">
      {done ? (
        <div className="flex flex-col items-center gap-4 text-center text-sm text-muted-foreground">
          <p>Пароль изменён. Войти на других устройствах нужно будет заново.</p>
          <Button asChild size="lg" className="w-full">
            <Link to="/login">Войти</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">Новый пароль</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-repeat">Повторите пароль</Label>
            <Input
              id="reset-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Сохранить пароль
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              Запросить новую ссылку
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
