import { Check } from "lucide-react";

import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const GROUPS = [
  {
    who: "Репетитору",
    pain: "Устали объяснять каждому новому ученику, как настроить три программы?",
    gains: [
      "Отправили ссылку — ученик на уроке",
      "Задания проверяются сами",
      "Выглядит солидно — растёт доверие родителей",
    ],
  },
  {
    who: "Онлайн-школе",
    pain: "Преподаватели ведут уроки кто во что горазд, а качество не проконтролировать?",
    gains: [
      "У всех учителей одинаковые удобные уроки",
      "Методисты готовят материалы один раз",
      "Видно, как учится каждый класс",
    ],
  },
  {
    who: "Учебному центру",
    pain: "Несколько филиалов, десятки групп и расходы на подписки, которые только растут?",
    gains: [
      "Одна подписка вместо пяти сервисов",
      "Своё оформление и свой адрес сайта",
      "Можно установить на ваш сервер",
    ],
  },
];

const SUBJECTS = [
  "математика",
  "русский язык",
  "английский",
  "физика",
  "химия",
  "биология",
  "история",
  "география",
  "информатика",
  "литература",
  "подготовка к ОГЭ и ЕГЭ",
  "музыка",
];

/** Три аудитории — колонками на линейке, как разворот тетради, а не три карточки с иконками. */
export function Audience() {
  return (
    <section id="audience" className="relative py-24 sm:py-32">
      <div className="container-l">
        <SectionHeading
          title="Кому подойдёт Матис"
          subtitle="Один урок или тысяча в месяц — платформа растёт вместе с вами."
        />

        <div className="mt-14 grid border-t border-foreground lg:grid-cols-3">
          {GROUPS.map(({ who, pain, gains }, i) => (
            <Reveal
              key={who}
              delay={i * 80}
              className="border-b border-border py-8 lg:border-b-0 lg:px-8 lg:first:pl-0 lg:last:pr-0 lg:[&:not(:first-child)]:border-l"
            >
              <h3 className="text-h3 text-foreground">{who}</h3>
              <p className="mt-3 max-w-[40ch] text-small text-muted-foreground">{pain}</p>
              <ul className="mt-6 space-y-3">
                {gains.map((g) => (
                  <li key={g} className="flex gap-3 text-small font-semibold text-foreground">
                    <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                    {g}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12 max-w-3xl text-body text-muted-foreground">
          <span className="font-semibold text-foreground">Подходит для любого предмета:</span>{" "}
          {SUBJECTS.join(", ")}.
        </Reveal>
      </div>
    </section>
  );
}
