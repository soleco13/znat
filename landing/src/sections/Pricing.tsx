import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthly: number | null;
  featured?: boolean;
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
    featured: true,
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

export function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="container-l">
        <SectionHeading
          eyebrow="Тарифы"
          title="Одна подписка вместо пяти"
          subtitle="Считали, сколько уходит на Zoom, Miro и сервис записи по отдельности? Здесь это дешевле — и в одном окне."
        />

        <Reveal className="mt-9 flex items-center justify-center gap-3">
          <span className={cn("text-[14px] font-medium", !yearly ? "text-foreground" : "text-muted-foreground")}>
            Помесячно
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            onClick={() => setYearly((v) => !v)}
            className={cn(
              "relative h-7 w-12 rounded-pill border border-border transition-colors duration-200 ease-ds",
              yearly ? "bg-primary" : "bg-surface-3",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-ds",
                yearly ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
          <span className={cn("text-[14px] font-medium", yearly ? "text-foreground" : "text-muted-foreground")}>
            На год
          </span>
          <Badge variant="green" className="ml-1">
            −17% · 2 месяца в подарок
          </Badge>
        </Reveal>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.id} delay={i * 90} className={cn(p.featured && "lg:-my-3")}>
              <article
                className={cn(
                  "relative flex h-full flex-col rounded-3xl border p-7",
                  p.featured
                    ? "border-primary/50 bg-card shadow-glow ring-1 ring-primary/10"
                    : "border-border bg-card shadow-sm",
                )}
              >
                {p.featured ? (
                  <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-pill bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground shadow-[0_8px_20px_-6px_rgba(29,78,216,0.7)]">
                    <Sparkles className="size-3.5" />
                    Выбор школ
                  </span>
                ) : null}

                <h3 className="text-[19px] font-heavy tracking-head text-foreground">{p.name}</h3>
                <p className="mt-1 min-h-[38px] text-[13.5px] text-muted-foreground">{p.tagline}</p>

                <div className="mt-6 flex min-h-[52px] items-end gap-1.5">
                  {p.monthly === null ? (
                    <span className="text-[32px] font-black leading-none tracking-tightest text-foreground">
                      Индивидуально
                    </span>
                  ) : (
                    <>
                      <span className="text-[42px] font-black leading-none tracking-tightest text-foreground">
                        {priceFmt.format(Math.round(yearly ? p.monthly * 10 / 12 : p.monthly))} ₽
                      </span>
                      <span className="pb-1.5 text-[13.5px] text-muted-foreground">/ мес</span>
                    </>
                  )}
                </div>
                <p className="mt-2 h-4 text-[12px] text-text-3">
                  {p.monthly !== null && yearly
                    ? `${priceFmt.format(p.monthly * 10)} ₽ в год`
                    : p.note ?? " "}
                </p>

                <Button
                  asChild
                  size="lg"
                  variant={p.featured ? "default" : "secondary"}
                  className="mt-6 w-full"
                >
                  <a href="#cta">{p.cta}</a>
                </Button>

                <ul className="mt-7 space-y-3 border-t border-border pt-6">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px] leading-snug text-foreground">
                      <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-primary-light text-primary">
                        <Check className="size-3" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-8 text-center text-[13.5px] text-muted-foreground">
          Все тарифы — 14 дней бесплатно, без карты. Ученики никогда не платят и не заводят аккаунт.
        </Reveal>
      </div>
    </section>
  );
}
