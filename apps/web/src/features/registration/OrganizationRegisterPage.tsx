import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { slugify, validateInn, validateOgrn } from "@school/shared";

import { cn } from "@/lib/utils";
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
import { registerOrganization } from "./registration-api.js";

const STEP_LABELS = ["Организация", "Вы"];

/** Э14.1 — self-signup ООО: создаёт новое именованное пространство (§ план-ТЗ Э14). Две страницы формы: организация → вы. */
export function OrganizationRegisterPage() {
  const [step, setStep] = useState<0 | 1>(0);
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
  const innOk = inn !== "" && validateInn(inn);
  const ogrnOk = ogrn !== "" && validateOgrn(ogrn);

  function goNext() {
    setError(null);
    if (orgName.trim() === "") {
      setError("Укажите название пространства");
      return;
    }
    if (!validateInn(inn)) {
      setError("Некорректный ИНН");
      return;
    }
    if (!validateOgrn(ogrn)) {
      setError("Некорректный ОГРН");
      return;
    }
    setStep(1);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (step === 0) {
      goNext();
      return;
    }
    setError(null);
    if (!validateInn(inn)) {
      setError("Некорректный ИНН");
      setStep(0);
      return;
    }
    if (!validateOgrn(ogrn)) {
      setError("Некорректный ОГРН");
      setStep(0);
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
    <AuthLayout aside={<StepsAside current={0} />}>
      <AuthHeading
        title="Пространство школы"
        subtitle="Учителя, ученики, материалы и записи — под одной крышей."
      />

      {/* Шаги формы */}
      <ol className="auth-rise mb-6 flex items-center gap-3" style={stagger(220)} aria-label="Шаги формы">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
            <span className="relative h-1 overflow-hidden rounded-full bg-border">
              <span
                className="absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-500"
                style={{ transform: i <= step ? "scaleX(1)" : "scaleX(0)", transitionTimingFunction: "var(--ease)" }}
              />
            </span>
            <span className={cn("text-xs font-semibold transition-colors duration-300", i <= step ? "text-foreground" : "text-text-3")}>
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {step === 0 ? (
          <div key="s0" className="auth-step flex flex-col gap-5">
            <Field
              id="org-name"
              label="Название пространства"
              hint={slugPreview ? <>Адрес пространства: <span className="font-mono">/s/{slugPreview}</span></> : undefined}
            >
              <Input
                id="org-name"
                autoComplete="organization"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className={authInput}
                autoFocus
                required
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="org-inn" label="ИНН" error={!innValid ? "Некорректный ИНН" : undefined}>
                <div className="relative">
                  <Input
                    id="org-inn"
                    inputMode="numeric"
                    value={inn}
                    onChange={(e) => setInn(e.target.value.trim())}
                    aria-invalid={!innValid}
                    className={cn(authInput, "pr-10")}
                    required
                  />
                  <Tick show={innOk} />
                </div>
              </Field>
              <Field id="org-ogrn" label="ОГРН" error={!ogrnValid ? "Некорректный ОГРН" : undefined}>
                <div className="relative">
                  <Input
                    id="org-ogrn"
                    inputMode="numeric"
                    value={ogrn}
                    onChange={(e) => setOgrn(e.target.value.trim())}
                    aria-invalid={!ogrnValid}
                    className={cn(authInput, "pr-10")}
                    required
                  />
                  <Tick show={ogrnOk} />
                </div>
              </Field>
            </div>

            <FormError message={error} />

            <Button type="button" size="lg" className="group h-12 w-full text-[16px]" onClick={goNext}>
              Далее
              <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
            </Button>
          </div>
        ) : (
          <div key="s1" className="auth-step flex flex-col gap-5">
            <Field id="org-fullname" label="Ваше имя и фамилия">
              <Input
                id="org-fullname"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={authInput}
                autoFocus
                required
              />
            </Field>
            <Field id="org-email" label="Email">
              <Input
                id="org-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authInput}
                required
              />
            </Field>
            <Field id="org-password" label="Пароль">
              <PasswordInput
                id="org-password"
                autoComplete="new-password"
                minLength={8}
                placeholder="Минимум 8 символов"
                value={password}
                onChange={setPassword}
              />
              <PasswordStrength value={password} />
            </Field>

            <PersonalDataConsent checked={consent} onChange={setConsent} />

            <FormError message={error} />

            <div className="flex gap-3">
              <Button type="button" variant="secondary" size="lg" className="h-12 px-5" onClick={() => setStep(0)}>
                <ArrowLeft aria-hidden />
                Назад
              </Button>
              <Button type="submit" size="lg" className="h-12 flex-1 text-[16px]" loading={submitting} disabled={!consent}>
                {submitting ? "Регистрируем…" : "Создать пространство"}
              </Button>
            </div>
          </div>
        )}
      </form>

      <p className="auth-rise mt-7 text-[14.5px]" style={stagger(400)}>
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

/** Зелёная галочка в конце поля: появляется, когда значение прошло проверку. */
function Tick({ show }: { show: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-success text-white transition-[transform,opacity] duration-300",
        show ? "scale-100 opacity-100" : "scale-50 opacity-0",
      )}
      style={{ transitionTimingFunction: "var(--ease-spring, cubic-bezier(0.34,1.4,0.64,1))" }}
    >
      <Check className="size-3" />
    </span>
  );
}
