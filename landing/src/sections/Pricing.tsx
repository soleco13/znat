import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { buttonVariants } from "@/components/ui/button";
import { LBadge } from "@/lesson/parts";

/**
 * Сетка владельца 2026-10-25. Цены и
 * лимиты — те же, что в каталоге оплаты `packages/shared/src/billing.ts`.
 * Объём тарифа — ученико-часы в месяц: аудитории и учителя в школьных тарифах
 * не ограничены, а урок не прерывается, даже если пакет закончился.
 */
type PlanId = "start" | "tutor" | "mini" | "school" | "pro" | "network" | "dedicated";

type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Рублей в месяц; `null` — по договору. */
  monthly: number | null;
  /** Ученико-часов в месяц; `null` — по мощности своих серверов. */
  hours: number | null;
  perLesson: string;
  recording: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: "start",
    name: "Старт",
    tagline: "Попробовать на паре учеников",
    monthly: 0,
    hours: 10,
    perLesson: "до 3",
    recording: "нет",
    features: [],
  },
  {
    id: "tutor",
    name: "Репетитор",
    tagline: "Один преподаватель: занятия один на один и мини-группы",
    monthly: 790,
    hours: 300,
    perLesson: "до 8",
    recording: "10 ч, 30 дней",
    features: [
      "Своя аудитория с постоянной ссылкой",
      "300 ученико-часов в месяц, до 8 учеников в уроке",
      "Доска, слайды, задания с автопроверкой",
      "Библиотека материалов",
      "Запись уроков: 10 ч в месяц, хранение 30 дней",
    ],
  },
  {
    id: "mini",
    name: "Мини-школа",
    tagline: "Несколько преподавателей и группы",
    monthly: 2990,
    hours: 1500,
    perLesson: "до 15",
    recording: "40 ч, 60 дней",
    features: [
      "Учителя и аудитории без ограничений",
      "1 500 ученико-часов в месяц, до 15 учеников в уроке",
      "Роли: администратор, методист, учитель",
      "Редактор материалов для методистов",
      "Запись уроков: 40 ч в месяц, хранение 60 дней",
    ],
  },
  {
    id: "school",
    name: "Школа",
    tagline: "Онлайн-школа или учебный центр",
    monthly: 8990,
    hours: 5000,
    perLesson: "до 30",
    recording: "150 ч, 90 дней",
    features: [
      "Учителя и аудитории без ограничений",
      "5 000 ученико-часов в месяц, класс до 30 учеников",
      "Роли, методисты и редактор материалов",
      "Успеваемость по каждому классу и ученику",
      "Запись уроков: 150 ч в месяц, хранение 90 дней",
      "Приоритетная поддержка",
    ],
  },
  {
    id: "pro",
    name: "Школа Про",
    tagline: "Большая школа",
    monthly: 17900,
    hours: 12000,
    perLesson: "до 50",
    recording: "500 ч, 180 дней",
    features: [
      "Всё из «Школы»",
      "12 000 ученико-часов в месяц, до 50 учеников в уроке",
      "Запись уроков: 500 ч в месяц, хранение 180 дней",
      "Персональный менеджер",
    ],
  },
  {
    id: "network",
    name: "Сеть",
    tagline: "Крупная школа или несколько филиалов",
    monthly: 59900,
    hours: 40000,
    perLesson: "до 100",
    recording: "1 000 ч, 365 дней",
    features: [
      "Всё из «Школы Про»",
      "40 000 ученико-часов в месяц, до 100 учеников в уроке",
      "Запись уроков: 1 000 ч в месяц, хранение 365 дней",
      "Свой домен и связка с вашей CRM — настраиваем при подключении",
      "Помощь с переносом материалов и обучением учителей",
    ],
  },
  {
    id: "dedicated",
    name: "Выделенный",
    tagline: "Свои серверы для вашей школы",
    monthly: null,
    hours: null,
    perLesson: "по договору",
    recording: "по договору",
    features: [
      "Отдельные серверы только для вашей школы",
      "Объём уроков и записи — под ваше расписание",
      "Свой домен, оформление и связка с вашей CRM",
      "Гарантия доступности 99,9 % и личный менеджер",
      "Перенос материалов и обучение учителей",
    ],
  },
];

const DEDICATED_FROM = 129000;
/** Ученико-часов в месяц на одного ученика: 2 урока в неделю по часу. */
const HOURS_PER_STUDENT = 2 * 4.33;
/** Шаги ползунка учеников; последний — «5 000 и больше». */
const STUDENT_STEPS = [5, 10, 15, 25, 35, 50, 80, 120, 170, 250, 350, 450, 570, 800, 1000, 1380, 2000, 3000, 4600, 5000];
const MAX_STEP = STUDENT_STEPS.length - 1;

const priceFmt = new Intl.NumberFormat("ru-RU");

const byId = (id: PlanId) => PLANS.find((p) => p.id === id)!;

/** Подбор: один преподаватель с небольшим числом учеников — «Репетитор», дальше — по пакету ученико-часов. */
function planFor(solo: boolean, students: number, isMax: boolean): Plan {
  if (isMax) return byId("dedicated");
  const hours = students * HOURS_PER_STUDENT;
  if (solo && hours <= byId("tutor").hours!) return byId("tutor");
  for (const id of ["mini", "school", "pro", "network"] as const) {
    if (hours <= byId(id).hours!) return byId(id);
  }
  return byId("dedicated");
}

const studentsWord = (n: number) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return "ученик";
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "ученика";
  return "учеников";
};

/** Плавно «доезжающее» число. */
function useTween(target: number, ms = 600) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = a + (target - a) * e;
      from.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Переключатель из двух вариантов — как переключатель периода оплаты. */
function Segmented<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [string, T][];
  onChange: (v: T) => void;
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex items-center gap-0.5 rounded-md bg-surface-3 p-1 text-muted-foreground">
      {options.map(([text, v]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-semibold transition-colors duration-150",
            value === v ? "bg-card text-foreground shadow-xs" : "hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

export function Pricing() {
  const [solo, setSolo] = useState(false);
  const [step, setStep] = useState(STUDENT_STEPS.indexOf(250));
  const [yearly, setYearly] = useState(false);
  const students = STUDENT_STEPS[step]!;
  const isMax = step === MAX_STEP;
  const plan = planFor(solo, students, isMax);
  const monthly = plan.monthly ?? DEDICATED_FROM;
  const price = Math.round(yearly && plan.monthly !== null ? (monthly * 10) / 12 : monthly);
  const shown = useTween(price);
  const pct = (step / MAX_STEP) * 100;

  return (
    <section id="pricing" className="relative py-24 sm:py-32">
      <div className="container-l">
        <SectionHeading
          title="Платите за уроки, а не за комнаты"
          subtitle="Цена зависит от того, сколько часов ученики проводят на уроках. Аудитории, ссылки и учителя — без ограничений."
        />

        <Reveal className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-20">
          {/* Подбор по числу учеников */}
          <div>
            <div className="lesson-ui">
              <Segmented
                label="Кто проводит уроки"
                value={solo}
                options={[
                  ["У нас школа", false],
                  ["Преподаю один", true],
                ]}
                onChange={setSolo}
              />
            </div>

            <p className="mt-8 text-small font-semibold text-text-2">Сколько у вас учеников?</p>
            <div className="mt-3 flex items-end gap-3">
              <span className="text-[88px] font-black leading-[0.9] tracking-tightest tabular-nums">
                {isMax ? "5 000+" : priceFmt.format(students)}
              </span>
              <span className="pb-2 text-small text-muted-foreground">{isMax ? "учеников" : studentsWord(students)}</span>
            </div>

            <div className="relative mt-8">
              <input
                type="range"
                min={0}
                max={MAX_STEP}
                step={1}
                value={step}
                onChange={(e) => setStep(Number(e.target.value))}
                aria-label="Число учеников"
                aria-valuetext={isMax ? "5 000 и больше учеников" : `${students} ${studentsWord(students)}`}
                className="price-range w-full"
                style={{ ["--p" as string]: `${pct}%` } as React.CSSProperties}
              />
              <div className="relative mt-3 h-4 text-caption text-text-3">
                <span className="absolute left-0">5</span>
                <span className="absolute -translate-x-1/2" style={{ left: `${(STUDENT_STEPS.indexOf(250) / MAX_STEP) * 100}%` }}>
                  250
                </span>
                <span className="absolute right-0">5 000+</span>
              </div>
            </div>
            <p className="mt-4 max-w-[46ch] text-caption text-text-3">
              {isMax
                ? "Для такого объёма ставим отдельные серверы под ваше расписание."
                : `Если у каждого 2 урока в неделю, это около ${priceFmt.format(Math.round((students * HOURS_PER_STUDENT) / 10) * 10)} ученико-часов в месяц.`}
            </p>

            <div className="lesson-ui mt-10 inline-flex items-center gap-3">
              <span className="text-[14px] font-semibold text-text-2">Оплата</span>
              <Segmented
                label="Период оплаты"
                value={yearly}
                options={[
                  ["Помесячно", false],
                  ["На год", true],
                ]}
                onChange={setYearly}
              />
              <LBadge variant="green">−17%</LBadge>
            </div>
          </div>

          {/* Результат */}
          <div key={plan.id} className="fade-in" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-foreground pb-5">
              <h3 className="text-[34px] font-black tracking-tightest">{plan.name}</h3>
              <p className="text-small text-muted-foreground">{plan.tagline}</p>
            </div>
            <div className="mt-6 flex items-end gap-2">
              {plan.monthly === null ? (
                <span className="pb-1.5 text-small text-muted-foreground">от</span>
              ) : null}
              <span className="text-[60px] font-black leading-none tracking-tightest tabular-nums">
                {priceFmt.format(Math.round(shown))} ₽
              </span>
              <span className="pb-1.5 text-small text-muted-foreground">/ мес</span>
            </div>
            <p className="mt-2 h-5 text-caption text-text-3">
              {plan.monthly === null
                ? "Цена зависит от объёма уроков и срока хранения записей"
                : yearly
                  ? `${priceFmt.format(plan.monthly * 10)} ₽ в год`
                  : " "}
            </p>

            <ul className="mt-6 space-y-3">
              {plan.features.map((f, i) => (
                <li
                  key={f}
                  className="slide-in flex gap-3 text-small text-foreground"
                  style={{ ["--d" as string]: `${i * 55}ms` } as React.CSSProperties}
                >
                  <Check className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>

            {plan.monthly === null ? (
              <a href="mailto:support@matis-edu.ru?subject=Тариф «Выделенный»" className={cn(buttonVariants({ size: "cta" }), "mt-9")}>
                Обсудить внедрение
              </a>
            ) : (
              <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
                {/* Путь покупки: тариф → цена → «Оплатить» → кабинет «Тариф» (после входа). */}
                <a href={`/billing?plan=${plan.id}&period=${yearly ? "year" : "month"}`} className={buttonVariants({ size: "cta" })}>
                  Оплатить {priceFmt.format(yearly ? plan.monthly * 10 : plan.monthly)} ₽
                </a>
                <a href="/register" className="text-small font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  или 14 дней бесплатно
                </a>
              </div>
            )}
          </div>
        </Reveal>

        {/* Все тарифы — строками на линейке, выбранный подсвечен. */}
        <Reveal className="mt-20">
          <h3 className="text-h3 text-foreground">Все тарифы</h3>
          <div
            aria-hidden
            className="mt-6 hidden grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-6 border-b border-foreground px-3 pb-3 text-caption font-semibold text-text-2 md:grid"
          >
            <span>Тариф</span>
            <span>В месяц</span>
            <span>Ученико-часов в месяц</span>
            <span>Учеников в уроке</span>
            <span>Запись и хранение</span>
          </div>
          <ul className="mt-6 border-t border-foreground md:mt-0 md:border-t-0">
            {PLANS.map((p) => {
              const current = p.id === plan.id;
              return (
                <li
                  key={p.id}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border px-3 py-5 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] md:items-baseline md:gap-6",
                    current && "bg-accent",
                  )}
                >
                  <div className="col-span-2 md:col-span-1">
                    <p className="font-bold text-foreground">{p.name}</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">{p.tagline}</p>
                  </div>
                  <Cell label="В месяц">
                    {p.monthly === null ? `от ${priceFmt.format(DEDICATED_FROM)} ₽` : p.monthly === 0 ? "бесплатно" : `${priceFmt.format(p.monthly)} ₽`}
                  </Cell>
                  <Cell label="Ученико-часов в месяц">{p.hours === null ? "по договору" : priceFmt.format(p.hours)}</Cell>
                  <Cell label="Учеников в уроке">{p.perLesson}</Cell>
                  <Cell label="Запись и хранение">{p.recording}</Cell>
                </li>
              );
            })}
          </ul>
        </Reveal>

        <Reveal className="mt-10 grid gap-6 text-small text-muted-foreground md:grid-cols-2 md:gap-12">
          <p>
            <span className="font-semibold text-foreground">Ученико-час</span> — час, который один ученик провёл на уроке.
            Урок на 45 минут с четырьмя учениками — это 3 ученико-часа. Время учителя не считается.
          </p>
          <p>
            <span className="font-semibold text-foreground">Если часы закончились</span>, уроки не прерываются. Мы напишем и
            предложим перейти на тариф побольше или докупить 1 000 ученико-часов за 3 490 ₽.
          </p>
        </Reveal>

        <Reveal className="mt-10 text-small text-muted-foreground">
          Все платные тарифы — 14 дней бесплатно, без карты. Ученики никогда не платят и не заводят аккаунт.
        </Reveal>
      </div>
    </section>
  );
}

/** Ячейка строки тарифа: на телефоне — с подписью, на широком экране подпись в шапке. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-caption text-text-3 md:sr-only">{label}</p>
      <p className="text-small font-semibold tabular-nums text-foreground">{children}</p>
    </div>
  );
}
