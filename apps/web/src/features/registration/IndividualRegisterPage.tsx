import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User } from "lucide-react";

import { ApiError } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import { PersonalDataConsent } from "@/shared/PersonalDataConsent";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { registerIndividual } from "./registration-api.js";

/** Э14.1 — self-signup репетитора: без организации, личное пространство создаётся под капотом. */
export function IndividualRegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await registerIndividual({ fullName, email, password, personalDataConsent: true });
      navigate("/register/check-email", { state: { email: result.email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось зарегистрироваться");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <User className="size-7" aria-hidden />
          </span>
          <h1 className="text-[22px] font-heavy tracking-tight">Регистрация репетитора</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Личный кабинет без организации</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-name">Имя и фамилия</Label>
            <Input
              id="reg-name"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-email">Email</Label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-password">Пароль</Label>
            <Input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="Минимум 8 символов"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <PersonalDataConsent checked={consent} onChange={setConsent} />

          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="mt-1 w-full" loading={submitting} disabled={!consent}>
            {submitting ? "Регистрируем…" : "Зарегистрироваться"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link to="/register" className="font-medium text-primary hover:underline">
            ← Назад к выбору
          </Link>
        </p>
      </div>
    </div>
  );
}
