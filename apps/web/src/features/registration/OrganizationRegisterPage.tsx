import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { slugify, validateInn, validateOgrn } from "@school/shared";

import { ApiError } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import { PersonalDataConsent } from "@/shared/PersonalDataConsent";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { registerOrganization } from "./registration-api.js";

/** Э14.1 — self-signup ООО: создаёт новое именованное пространство (§ план-ТЗ Э14). */
export function OrganizationRegisterPage() {
  const [orgName, setOrgName] = useState("");
  const [inn, setInn] = useState("");
  const [ogrn, setOgrn] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const slugPreview = useMemo(() => slugify(orgName), [orgName]);
  const innValid = inn === "" || validateInn(inn);
  const ogrnValid = ogrn === "" || validateOgrn(ogrn);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validateInn(inn)) {
      setError("Некорректный ИНН");
      return;
    }
    if (!validateOgrn(ogrn)) {
      setError("Некорректный ОГРН");
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerOrganization({ orgName, inn, ogrn, fullName, email, password, personalDataConsent: true });
      navigate("/register/check-email", { state: { email: result.email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось зарегистрироваться");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-card p-9 shadow-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="size-7" aria-hidden />
          </span>
          <h1 className="text-[22px] font-heavy tracking-tight">Регистрация организации</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Создайте пространство своей школы</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Название пространства</Label>
            <Input
              id="org-name"
              autoComplete="organization"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
            />
            {slugPreview ? (
              <p className="text-xs text-muted-foreground">Адрес пространства: /s/{slugPreview}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-inn">ИНН</Label>
            <Input
              id="org-inn"
              inputMode="numeric"
              value={inn}
              onChange={(e) => setInn(e.target.value.trim())}
              aria-invalid={!innValid}
              required
            />
            {!innValid ? <p className="text-xs text-destructive">Некорректный ИНН</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-ogrn">ОГРН</Label>
            <Input
              id="org-ogrn"
              inputMode="numeric"
              value={ogrn}
              onChange={(e) => setOgrn(e.target.value.trim())}
              aria-invalid={!ogrnValid}
              required
            />
            {!ogrnValid ? <p className="text-xs text-destructive">Некорректный ОГРН</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-fullname">Ваше имя и фамилия</Label>
            <Input
              id="org-fullname"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-email">Email</Label>
            <Input
              id="org-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-password">Пароль</Label>
            <Input
              id="org-password"
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
            {submitting ? "Регистрируем…" : "Создать пространство"}
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
