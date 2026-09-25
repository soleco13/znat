import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, Eye, EyeOff, GraduationCap, Hand } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import "./auth.css";

/** Задержка появления (мс) для каскада `.auth-rise` / `.auth-pop`. */
export const stagger = (ms: number) => ({ ["--d" as string]: `${ms}ms` }) as CSSProperties;

/* ───────────── Макет: форма слева, тетрадный лист справа ───────────── */

export function AuthLayout({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex min-h-dvh flex-col px-6 py-6 sm:px-12 lg:px-16">
        <header className="auth-rise flex items-center">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Матис">
            <span className="flex size-[34px] items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
              <GraduationCap className="size-[19px]" aria-hidden />
            </span>
            <span className="text-[16px] font-bold tracking-[-.02em]">Матис</span>
          </Link>
        </header>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">{children}</div>
      </main>
      <aside aria-hidden className="auth-notebook hidden overflow-hidden border-l border-border lg:block">
        {aside}
      </aside>
    </div>
  );
}

/** Заголовок формы: крупный, с подзаголовком. */
export function AuthHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="auth-rise text-[30px] font-black leading-[1.08] tracking-[-.03em] [overflow-wrap:anywhere] min-[400px]:text-[34px] sm:text-[40px]" style={stagger(80)}>
        {title}
      </h1>
      {subtitle ? (
        <p className="auth-rise mt-3 text-[15.5px] leading-relaxed text-muted-foreground" style={stagger(160)}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────── Поля формы ───────────── */

export function Field({
  id,
  label,
  hint,
  error,
  aside,
  delay = 0,
  children,
}: {
  id: string;
  label: string;
  /** Справа от подписи (например, «Забыли пароль?»). */
  aside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <div className="auth-rise flex flex-col gap-1.5" style={stagger(delay)}>
      {aside ? (
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={id}>{label}</Label>
          {aside}
        </div>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Крупное поле ввода (44 px) для форм авторизации. */
export const authInput = "h-11 text-[15.5px]";

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className={cn(authInput, "pr-12")}
        required
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
        className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        {shown ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
      </button>
    </div>
  );
}

/** Ошибка формы: при каждом новом сообщении «встряхивается». */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      key={message}
      role="alert"
      className="auth-shake flex items-start gap-2 rounded-lg border border-[#fecaca] bg-danger-light px-3 py-2.5 text-sm font-medium text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/** Простая клиентская оценка надёжности пароля (только подсказка, правила сервера не меняет). */
export function PasswordStrength({ value }: { value: string }) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-zа-я]/i.test(value) && /\d/.test(value)) score += 1;
  if (/[^\p{L}\d]/u.test(value)) score += 1;
  const label = value.length === 0 ? "Минимум 8 символов" : ["Слишком короткий", "Слабый", "Нормальный", "Хороший", "Надёжный"][score]!;
  const tone = score <= 1 ? "bg-destructive" : score === 2 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className={cn("absolute inset-0 origin-left rounded-full transition-transform duration-500", tone)}
              style={{ transform: i < score ? "scaleX(1)" : "scaleX(0)", transitionTimingFunction: "var(--ease)" }}
            />
          </span>
        ))}
      </div>
      <span className="w-[112px] text-right text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/* ───────────── Правая часть ───────────── */

const TILES = [
  { n: "Аня", speaking: true },
  { n: "Илья", hand: true },
  { n: "Соня" },
  { n: "Егор" },
  { n: "Лиза" },
];

/** Вход: «класс уже собирается» — плитки участников появляются по одной, ждут вас. */
export function LobbyAside() {
  return (
    <div className="flex h-full flex-col justify-center gap-10 py-14 pl-[clamp(48px,11%,132px)] pr-10 xl:pr-16">
      <h2 className="max-w-[12ch] text-[clamp(40px,4.6vw,68px)] font-black leading-[1.02] tracking-[-.035em] text-foreground">
        <span className="auth-rise block" style={stagger(200)}>Класс уже</span>
        <span className="auth-rise block" style={stagger(320)}>
          <span className="auth-mark" style={stagger(1100)}>собирается</span>.
        </span>
      </h2>

      <div className="auth-rise w-full max-w-[560px] overflow-hidden rounded-[20px] border border-border bg-card shadow-lg" style={stagger(500)}>
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-3.5">
          <span className="flex size-6 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
            <GraduationCap className="size-[14px]" aria-hidden />
          </span>
          <span className="text-[13.5px] font-bold tracking-[-.02em]">Алгебра · 8 класс</span>
          <span className="inline-flex h-[22px] items-center gap-[5px] rounded-full bg-success-light px-2 text-[11px] font-semibold text-success">
            <span className="size-[5px] rounded-full bg-current" />
            На связи
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 p-3.5">
          {TILES.map((t, i) => (
            <div
              key={t.n}
              className="auth-pop relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-slate-900"
              style={stagger(900 + i * 320)}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-[14px] font-bold text-white">
                {t.n[0]}
              </span>
              {t.speaking ? (
                <>
                  <span className="auth-speak pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-primary" style={stagger(2000)} />
                  <span
                    className="auth-speak absolute left-2 top-2 inline-flex h-5 items-center rounded-full bg-primary px-2 text-[10.5px] font-semibold text-primary-foreground"
                    style={stagger(2000)}
                  >
                    говорит
                  </span>
                </>
              ) : null}
              {t.hand ? (
                <span
                  className="auth-pop absolute right-2 top-2 flex size-[22px] items-center justify-center rounded-full bg-warning text-warning-foreground"
                  style={stagger(2600)}
                >
                  <Hand className="size-3" aria-hidden />
                </span>
              ) : null}
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-[rgba(16,24,40,.72)] px-2 py-0.5 text-[10.5px] font-medium text-white">
                {t.n}
              </span>
            </div>
          ))}
          <div
            className="auth-pop flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-primary-muted bg-primary-light text-primary"
            style={stagger(900 + TILES.length * 320)}
          >
            <span className="text-[13px] font-bold">Вы</span>
            <span className="text-[11px] font-medium">ждём вас</span>
          </div>
        </div>

        <div className="border-t border-border px-3.5 py-3">
          <div className="auth-rise flex flex-col gap-[3px]" style={stagger(3300)}>
            <span className="text-[12px] font-semibold text-foreground">
              Марина Петровна <span className="ml-1 font-normal text-text-3">10:00</span>
            </span>
            <span className="self-start rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-[13px]">
              Начинаем, ждём только вас.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { t: "Создайте аккаунт", d: "Имя, почта и пароль — меньше минуты." },
  { t: "Подтвердите почту", d: "Перейдите по ссылке из письма — и вы внутри." },
  { t: "Проведите первый урок", d: "Пришлите ученикам одну ссылку. Без установки." },
];

/** Регистрация: три шага; пройденные отмечены, текущий подсвечен. */
export function StepsAside({ current }: { current: 0 | 1 | 2 }) {
  return (
    <div className="flex h-full flex-col justify-center gap-12 py-14 pl-[clamp(48px,11%,132px)] pr-10 xl:pr-16">
      <h2 className="max-w-[13ch] text-[clamp(38px,4.2vw,62px)] font-black leading-[1.02] tracking-[-.035em] text-foreground">
        <span className="auth-rise block" style={stagger(200)}>Первый урок —</span>
        <span className="auth-rise relative block" style={stagger(320)}>
          <span className="relative inline-block">
            сегодня
            <svg aria-hidden viewBox="0 0 100 10" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-[0.2em] w-full overflow-visible">
              <path
                className="auth-ink"
                style={{ ["--len" as string]: 120, ["--d" as string]: "1000ms" } as CSSProperties}
                d="M1 5 C 20 8, 40 1, 62 6 S 90 3, 99 6"
                fill="none"
                stroke="#e03131"
                strokeWidth="3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </span>
          .
        </span>
      </h2>

      <ol className="flex max-w-[440px] flex-col gap-7">
        {STEPS.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s.t} className="auth-rise flex gap-4" style={stagger(600 + i * 180)}>
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold transition-colors duration-500",
                  done && "border-success bg-success text-white",
                  now && "border-primary bg-primary text-primary-foreground shadow-[0_0_0_5px_rgba(29,78,216,0.14)]",
                  !done && !now && "border-border bg-card text-text-3",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span>
                <span className={cn("block text-[17px] font-bold tracking-[-.02em]", !done && !now && "text-text-2")}>{s.t}</span>
                <span className="mt-0.5 block text-[14.5px] leading-relaxed text-muted-foreground">{s.d}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="auth-rise text-[14px] text-text-3" style={stagger(1300)}>
        14 дней бесплатно, без карты. Ученики не платят и не заводят аккаунт.
      </p>
    </div>
  );
}
