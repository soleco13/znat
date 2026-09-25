import { useState, type FormEvent } from "react";

import { ApiError } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { changePassword } from "./account-api.js";

/** Смена своего пароля. Другие устройства после смены выходят из аккаунта. */
export function ChangePasswordPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 8) return setError("Новый пароль — не короче 8 символов");
    if (next !== repeat) return setError("Пароли не совпадают");
    setSubmitting(true);
    try {
      const session = await changePassword({ currentPassword: current, newPassword: next });
      setAuth(session.accessToken, session.user);
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сменить пароль");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="mb-6 text-2xl font-heavy tracking-tight">Смена пароля</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-current">Текущий пароль</Label>
          <Input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-new">Новый пароль</Label>
          <Input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-repeat">Повторите новый пароль</Label>
          <Input
            id="cp-repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>
        {error ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="text-sm font-medium text-success" role="status">
            Пароль изменён. На других устройствах нужно будет войти заново.
          </p>
        ) : null}
        <Button type="submit" loading={submitting} disabled={!current || !next}>
          Сменить пароль
        </Button>
      </form>
    </div>
  );
}
