import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Layout } from "@/site/Layout";
import { APP, DEMO_HREF, billingHref } from "@/lib/site";
import { DEDICATED_FROM, DEDICATED_PUBLIC, VISIBLE_PLANS as PLANS, YEAR_MONTHS_CHARGED, num, rub, type Plan } from "@/lib/plans";
import { SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL } from "@/lib/contacts";

const TUTOR = PLANS.filter((p) => p.id === "start" || p.id === "tutor");
const SCHOOL = PLANS.filter((p) => p.id !== "start" && p.id !== "tutor");

export function PricingPage() {
  const [yearly, setYearly] = useState(false);
  return (
    <Layout page="pricing">
      <section className="pb-6 pt-12 sm:pt-20">
        <div className="container-l">
          <h1 className="text-h2 text-foreground">Тарифы</h1>
          <p className="mt-5 max-w-[52ch] text-body text-text-2 sm:text-lead">
            Цена зависит от того, сколько часов ученики проводят на уроках. Ученики не платят и не заводят аккаунт.
          </p>
          <div className="mt-10">
            <Period yearly={yearly} onChange={setYearly} />
          </div>
        </div>
      </section>

      <PlanGroup title="Репетиторам" note="Один преподаватель, своя аудитория с постоянной ссылкой." plans={TUTOR} yearly={yearly} />
      {SCHOOL.length > 0 ? (
        <PlanGroup
          title="Школам"
          note="Учителя и аудитории без ограничений, роли администратора и методиста."
          plans={SCHOOL}
          yearly={yearly}
        />
      ) : null}
      {DEDICATED_PUBLIC ? <Dedicated /> : null}
      <Compare />
      <Notes />
    </Layout>
  );
}

function Period({ yearly, onChange }: { yearly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="radiogroup" aria-label="Период оплаты" className="inline-flex rounded-md bg-surface-3 p-1">
        {(
          [
            ["Помесячно", false],
            ["На год", true],
          ] as const
        ).map(([label, v]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={yearly === v}
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex h-10 cursor-pointer items-center rounded-sm px-5 text-small font-semibold transition-colors duration-150",
              yearly === v ? "bg-card text-foreground shadow-xs" : "text-text-2 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-small text-text-3">За год — как за {YEAR_MONTHS_CHARGED} месяцев.</p>
    </div>
  );
}

function priceOf(p: Plan, yearly: boolean) {
  if (p.monthly === 0) return { main: "0 ₽", sub: "бесплатно, без срока" };
  if (!yearly) return { main: rub(p.monthly), sub: "в месяц" };
  const year = p.monthly * YEAR_MONTHS_CHARGED;
  return { main: rub(Math.round(year / 12)), sub: `в месяц, ${rub(year)} за год` };
}

function recordingOf(p: Plan) {
  return p.recordingHours === 0 ? "Без записи уроков" : `Запись: ${num(p.recordingHours)} ч в месяц, хранится ${p.retentionDays} дней`;
}

function PlanGroup({ title, note, plans, yearly }: { title: string; note: string; plans: Plan[]; yearly: boolean }) {
  const cols = plans.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-4";
  return (
    <section aria-labelledby={`g-${title}`} className="py-10">
      <div className="container-l">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-foreground pb-4">
          <h2 id={`g-${title}`} className="text-h3 text-foreground">
            {title}
          </h2>
          <p className="text-small text-text-2">{note}</p>
        </div>
        <ul className={cn("grid", cols)}>
          {plans.map((p) => (
            <PlanColumn key={p.id} plan={p} yearly={yearly} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function PlanColumn({ plan: p, yearly }: { plan: Plan; yearly: boolean }) {
  const price = priceOf(p, yearly);
  const free = p.monthly === 0;
  return (
    <li className="flex flex-col border-b border-border py-8 md:border-b-0 md:px-6 md:first:pl-0 md:[&:not(:first-child)]:border-l">
      <h3 className="text-[22px] font-bold tracking-[-0.02em] text-foreground">{p.name}</h3>
      <p className="mt-1 min-h-[3.2em] text-small text-text-2">{p.forWhom}</p>

      <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[40px] font-black leading-none tracking-tightest tabular-nums text-foreground">{price.main}</span>
      </p>
      <p className="mt-2 text-caption text-text-3">{price.sub}</p>

      <ul className="mt-6 space-y-2.5 text-small text-foreground">
        <li>
          <span className="font-semibold tabular-nums">{num(p.hours)}</span> ученико-часов в месяц
        </li>
        <li>
          До <span className="font-semibold tabular-nums">{p.studentsPerLesson}</span> учеников в уроке
        </li>
        <li className={cn(p.recordingHours === 0 && "text-text-3")}>{recordingOf(p)}</li>
        {p.extra ? <li>{p.extra}</li> : null}
      </ul>

      <div className="mt-auto pt-8">
        {free ? (
          <a href={APP.register} className={cn(buttonVariants({ variant: "secondary" }), "w-full")}>
            Начать бесплатно
          </a>
        ) : (
          <a
            href={billingHref(p.id, yearly)}
            aria-label={`Подключить тариф «${p.name}»`}
            className={cn(buttonVariants(), "w-full")}
          >
            Подключить
          </a>
        )}
      </div>
    </li>
  );
}

function Dedicated() {
  return (
    <section aria-labelledby="dedicated" className="py-10">
      <div className="container-l">
        <div className="grid gap-6 border-y border-foreground py-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-12">
          <div>
            <h2 id="dedicated" className="text-[22px] font-bold tracking-[-0.02em] text-foreground">
              Выделенный <span className="font-semibold text-text-2">— от {rub(DEDICATED_FROM)} в месяц</span>
            </h2>
            <p className="mt-2 max-w-[62ch] text-small text-text-2">
              Отдельные серверы только для вашей школы или установка на ваш сервер. Объём уроков и хранение записей — под
              ваше расписание, свой домен и оформление. Условия — по договору.
            </p>
          </div>
          <a href={DEMO_HREF} className={cn(buttonVariants({ variant: "secondary" }), "justify-self-start")}>
            Обсудить условия
          </a>
        </div>
      </div>
    </section>
  );
}

const ROWS: { label: string; value: (p: Plan) => string }[] = [
  { label: "Цена в месяц", value: (p) => (p.monthly === 0 ? "0 ₽" : rub(p.monthly)) },
  { label: "Ученико-часов в месяц", value: (p) => num(p.hours) },
  { label: "Учеников в уроке", value: (p) => `до ${p.studentsPerLesson}` },
  { label: "Учителей", value: (p) => (p.teachers === null ? "без ограничений" : String(p.teachers)) },
  { label: "Аудиторий", value: (p) => (p.rooms === null ? "без ограничений" : String(p.rooms)) },
  { label: "Методисты и администраторы", value: (p) => (p.methodists ? "есть" : "—") },
  { label: "Запись в месяц", value: (p) => (p.recordingHours === 0 ? "—" : `${num(p.recordingHours)} ч`) },
  { label: "Хранение записи", value: (p) => (p.retentionDays === null ? "—" : `${p.retentionDays} дней`) },
  { label: "Библиотека материалов Матиса", value: (p) => (p.library ? "есть" : "—") },
];

/** Подробное сравнение — по запросу: основное уже есть в колонках выше. */
function Compare() {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="compare" className="py-10">
      <div className="container-l">
        <h2 id="compare" className="sr-only">
          Сравнение тарифов
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="compare-table"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-small font-semibold text-foreground"
        >
          {open ? "Скрыть сравнение" : "Сравнить все тарифы"}
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>
        {open ? (
          <div id="compare-table" className="fade-in mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-small">
              <caption className="sr-only">Лимиты тарифов</caption>
              <thead>
                <tr className="border-b border-foreground">
                  <th scope="col" className="py-3 pr-4 font-semibold text-text-2">
                    <span className="sr-only">Параметр</span>
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} scope="col" className="px-3 py-3 font-bold text-foreground">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-border">
                    <th scope="row" className="py-3 pr-4 font-medium text-text-2">
                      {r.label}
                    </th>
                    {PLANS.map((p) => (
                      <td key={p.id} className="px-3 py-3 tabular-nums text-foreground">
                        {r.value(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const NOTES = [
  {
    q: "Что такое ученико-час",
    a: "Час, который один ученик провёл на уроке. Урок на 45 минут с четырьмя учениками — это 3 ученико-часа. Время учителя не считается.",
  },
  {
    q: "Что будет, если часы закончились",
    a: "Урок не прервётся. Мы напишем и предложим перейти на тариф побольше.",
  },
  {
    q: "Как оплатить",
    a: "В кабинете, в разделе «Тариф»: разовой оплатой на месяц или год либо подпиской с автосписанием через СБП. Сначала нужно зарегистрироваться или войти.",
  },
  {
    q: "Вопросы по оплате и возврату",
    a: null,
  },
];

function Notes() {
  return (
    <section aria-labelledby="notes" className="pb-24 pt-10">
      <div className="container-l">
        <h2 id="notes" className="sr-only">
          Подробности
        </h2>
        <dl className="grid gap-x-16 gap-y-8 border-t border-border pt-10 md:grid-cols-2">
          {NOTES.map((n) => (
            <div key={n.q}>
              <dt className="font-bold text-foreground">{n.q}</dt>
              <dd className="mt-2 max-w-[56ch] text-small text-text-2">
                {n.a ?? (
                  <>
                    Напишите в Telegram{" "}
                    <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer" className="font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4 hover:decoration-primary">
                      {SUPPORT_TELEGRAM}
                    </a>
                    . Школам и организациям — также на почту, все способы{" "}
                    <a href="/contacts" className="font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4 hover:decoration-primary">
                      на странице контактов
                    </a>
                    .
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
