import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { LBadge } from "@/lesson/parts";

type Plan = {
  id: "tutor" | "school" | "network";
  name: string;
  tagline: string;
  monthly: number | null;
  cta: string;
  features: string[];
  note?: string;
};

const PLANS: Plan[] = [
  {
    id: "tutor",
    name: "Репетитор",
    tagline: "Индивидуальные занятия и мини-группы",
    monthly: 990,
    cta: "Начать бесплатно",
    features: [
      "1 учитель, до 6 учеников в уроке",
      "Доска, слайды, задания",
      "Библиотека материалов",
      "Запись урока (до 20 ч в месяц)",
      "Вход учеников по ссылке",
    ],
  },
  {
    id: "school",
    name: "Школа",
    tagline: "Для онлайн-школы или учебного центра",
    monthly: 6900,
    cta: "Попробовать 14 дней",
    features: [
      "До 15 учителей, класс до 30 учеников",
      "Всё из «Репетитора»",
      "Редактор материалов для методистов",
      "Разбор, аналитика по классу, очередь проверки",
      "Запись без лимита минут",
      "Роли: администратор · методист · учитель",
      "Приоритетная поддержка",
    ],
  },
  {
    id: "network",
    name: "Сеть",
    tagline: "Несколько школ, свой сервер, свой домен",
    monthly: null,
    cta: "Обсудить внедрение",
    features: [
      "Учителя и ученики без ограничений",
      "Развёртывание на вашем сервере (self-hosted)",
      "Свой домен и брендирование",
      "SSO и интеграция с вашей CRM",
      "SLA и выделенный менеджер",
      "Помощь с миграцией материалов",
    ],
    note: "Цена по договорённости",
  },
];

const priceFmt = new Intl.NumberFormat("ru-RU");

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

const planFor = (teachers: number): Plan => (teachers <= 1 ? PLANS[0]! : teachers <= 15 ? PLANS[1]! : PLANS[2]!);

export function Pricing() {
  const [teachers, setTeachers] = useState(6);
  const [yearly, setYearly] = useState(false);
  const plan = planFor(teachers);
  const price = plan.monthly === null ? 0 : Math.round(yearly ? (plan.monthly * 10) / 12 : plan.monthly);
  const shown = useTween(price);
  const pct = ((teachers - 1) / 19) * 100;

  return (
    <section id="pricing" className="relative py-24 sm:py-32">
      <div className="container-l">
        <SectionHeading
          title="Одна подписка вместо пяти"
          subtitle="Считали, сколько уходит на Zoom, Miro и сервис записи по отдельности? Здесь это дешевле — и в одном окне."
        />

        <Reveal className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-20">
          {/* Подбор по числу учителей */}
          <div>
            <p className="text-[15px] font-semibold text-text-2">Сколько у вас учителей?</p>
            <div className="mt-3 flex items-end gap-3">
              <span className="text-[88px] font-black leading-[0.9] tracking-tightest tabular-nums">
                {teachers >= 20 ? "20+" : teachers}
              </span>
              <span className="pb-2 text-[15px] text-muted-foreground">
                {teachers === 1 ? "учитель" : teachers < 5 ? "учителя" : "учителей"}
              </span>
            </div>

            <div className="relative mt-8">
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={teachers}
                onChange={(e) => setTeachers(Number(e.target.value))}
                aria-label="Число учителей"
                className="price-range w-full"
                style={{ ["--p" as string]: `${pct}%` } as React.CSSProperties}
              />
              <div className="relative mt-3 h-4 text-[12.5px] text-text-3">
                <span className="absolute left-0">1</span>
                <span className="absolute -translate-x-1/2" style={{ left: `${(14 / 19) * 100}%` }}>
                  15
                </span>
                <span className="absolute right-0">20+</span>
              </div>
            </div>

            <div className="lesson-ui mt-10 inline-flex items-center gap-3">
              <span className="text-[14px] font-semibold text-text-2">Оплата</span>
              <span className="inline-flex items-center gap-0.5 rounded-[11px] bg-surface-3 p-1 text-muted-foreground">
                {[
                  ["Помесячно", false],
                  ["На год", true],
                ].map(([label, y]) => (
                  <button
                    key={String(label)}
                    type="button"
                    onClick={() => setYearly(y as boolean)}
                    className={cn(
                      "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-200",
                      yearly === y ? "bg-card text-foreground shadow-xs" : "hover:text-foreground",
                    )}
                  >
                    {label as string}
                  </button>
                ))}
              </span>
              <LBadge variant="green">−17%</LBadge>
            </div>
          </div>

          {/* Результат */}
          <div key={plan.id} className="fade-in">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-foreground pb-5">
              <h3 className="text-[34px] font-black tracking-tightest">{plan.name}</h3>
              <p className="text-[15px] text-muted-foreground">{plan.tagline}</p>
            </div>
            <div className="mt-6 flex items-end gap-2">
              {plan.monthly === null ? (
                <span className="text-[40px] font-black leading-none tracking-tightest">Индивидуально</span>
              ) : (
                <>
                  <span className="text-[60px] font-black leading-none tracking-tightest tabular-nums">
                    {priceFmt.format(Math.round(shown))} ₽
                  </span>
                  <span className="pb-1.5 text-[15px] text-muted-foreground">/ мес</span>
                </>
              )}
            </div>
            <p className="mt-2 h-5 text-[13px] text-text-3">
              {plan.monthly !== null && yearly ? `${priceFmt.format(plan.monthly * 10)} ₽ в год` : (plan.note ?? " ")}
            </p>

            <ul className="mt-6 space-y-3">
              {plan.features.map((f, i) => (
                <li
                  key={f}
                  className="slide-in flex gap-3 text-[15.5px] leading-snug text-foreground"
                  style={{ ["--d" as string]: `${i * 55}ms` } as React.CSSProperties}
                >
                  <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>

            <a
              href="#cta"
              className="btn-press mt-9 inline-flex h-[54px] items-center justify-center rounded-[14px] bg-primary px-8 text-[16px] font-semibold text-primary-foreground hover:bg-primary-hover hover:shadow-[0_10px_30px_-8px_rgba(29,78,216,0.55)]"
            >
              {plan.cta}
            </a>
          </div>
        </Reveal>

        <Reveal className="mt-14 text-[14px] text-muted-foreground">
          Все тарифы — 14 дней бесплатно, без карты. Ученики никогда не платят и не заводят аккаунт.
        </Reveal>
      </div>
    </section>
  );
}
