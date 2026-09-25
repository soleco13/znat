import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { ApiError } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import { PersonalDataConsent } from "@/shared/PersonalDataConsent";
import { Input } from "@/shared/ui/input";
import {
  AuthHeading,
  AuthLayout,
  Field,
  FormError,
  PasswordInput,
  PasswordStrength,
  StepsAside,
  authInput,
  stagger,
} from "../auth/AuthLayout.js";
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
    <AuthLayout aside={<StepsAside current={0} />}>
      <AuthHeading title="Кабинет репетитора" subtitle="Свои уроки, материалы и ученики — без организации." />

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field id="reg-name" label="Имя и фамилия" delay={240}>
          <Input
            id="reg-name"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={authInput}
            autoFocus
            required
          />
        </Field>
        <Field id="reg-email" label="Email" delay={300}>
          <Input
            id="reg-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
            required
          />
        </Field>
        <Field id="reg-password" label="Пароль" delay={360}>
          <PasswordInput
            id="reg-password"
            autoComplete="new-password"
            minLength={8}
            placeholder="Минимум 8 символов"
            value={password}
            onChange={setPassword}
          />
          <PasswordStrength value={password} />
        </Field>

        <div className="auth-rise" style={stagger(400)}>
          <PersonalDataConsent checked={consent} onChange={setConsent} />
        </div>

        <FormError message={error} />

        <div className="auth-rise" style={stagger(430)}>
          <Button type="submit" size="lg" className="h-12 w-full text-[16px]" loading={submitting} disabled={!consent}>
            {submitting ? "Регистрируем…" : "Зарегистрироваться"}
          </Button>
        </div>
      </form>

      <p className="auth-rise mt-7 text-[14.5px]" style={stagger(500)}>
        <Link
          to="/register"
          className="group inline-flex items-center gap-1.5 font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-1" aria-hidden />
          Назад к выбору
        </Link>
      </p>
    </AuthLayout>
  );
}
