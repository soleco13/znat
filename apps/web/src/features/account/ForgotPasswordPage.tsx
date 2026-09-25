import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { requestPasswordReset } from "./account-api.js";
import { AuthCard } from "./AuthCard.js";

/** «Забыли пароль?» — письмо со ссылкой на новый пароль. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset({ email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить письмо");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Восстановление пароля" subtitle={sent ? undefined : "Пришлём ссылку для нового пароля"}>
      {sent ? (
        <p className="text-center text-sm text-muted-foreground">
          Если аккаунт с адресом <strong>{email}</strong> есть, письмо уже в пути. Ссылка действует 1 час.
          Проверьте и папку «Спам».
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={!email.trim()}>
            Отправить ссылку
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Вернуться ко входу
        </Link>
      </p>
    </AuthCard>
  );
}
