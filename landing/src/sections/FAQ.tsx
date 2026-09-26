import { useState } from "react";
import { Hand } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { UserAvatar } from "@/lesson/parts";

const QA = [
  {
    q: "Ученику нужно что-то устанавливать?",
    a: "Нет. Урок открывается в браузере на компьютере, планшете и телефоне. Ученик переходит по ссылке, вводит имя, проходит быструю проверку камеры и микрофона — и он в классе. Аккаунт и пароль не нужны.",
  },
  {
    q: "Сколько человек выдержит групповой урок?",
    a: "До 30 учеников с видео. Для больших классов есть режим «Лекция»: ученики видят и слышат учителя, а слово дают по поднятой руке. В режиме «Обсуждение» на экране до 9 учеников сразу. Кто и когда говорит — решает учитель."
  },
  {
    q: "Чем это лучше связки Zoom + Miro + Google Формы?",
    a: "Всё в одном окне: не нужно переключать вкладки, рассылать три ссылки и собирать ответы вручную. Презентация показывается чётко, задания проверяются сами, запись лежит рядом с уроком. И вы платите за одну подписку вместо нескольких."
  },
  {
    q: "Можно развернуть на своём сервере?",
    a: "Да, на тарифе «Сеть». Мы сами установим платформу на ваш сервер и поможем с настройкой. Все уроки, записи и данные учеников останутся только у вас."
  },
  {
    q: "Это законно? Что с персональными данными и записью?",
    a: "Всё по закону. Ученикам не нужно регистрироваться и оставлять телефон или почту — достаточно имени. Запись включается только вручную, и все участники видят предупреждение. Скачать запись можно только по временной ссылке."
  },
  {
    q: "Что с материалами — их надо делать с нуля?",
    a: "Не обязательно. Есть редактор с готовыми конструкциями (разбор задачи, словарный диктант, проверочная) и импорт вопросов из Word и PDF. Стартовая библиотека по основным предметам входит в тариф «Школа».",
  },
  {
    q: "Есть пробный период?",
    a: "14 дней бесплатно на любом тарифе, без привязки карты. За это время можно провести реальные уроки и собрать материалы — ничего не сбросится после перехода на подписку.",
  },
];

const ASKERS = ["Анна К.", "Игорь Т.", "Марина Ш.", "Олег Р.", "Светлана Д.", "Павел Н.", "Юля М."];

/** Вопросы — «поднятые руки»: строки как в списке участников, ответ учителя — сообщением в чате. */
export function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="relative py-24 sm:py-32">
      <div className="container-l grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            title="Поднимите руку — ответим"
            subtitle="Семь вопросов, которые задают чаще всего. Нажмите на любой."
          />
        </div>

        <Reveal className="lesson-ui flex flex-col gap-0.5">
          {QA.map((item, i) => {
            const on = open === i;
            return (
              <div key={i} className="rounded-md">
                <button
                  type="button"
                  onClick={() => setOpen(on ? -1 : i)}
                  aria-expanded={on}
                  className={cn(
                    "flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-md p-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2",
                    on && "bg-surface-2",
                  )}
                >
                  <UserAvatar name={ASKERS[i % ASKERS.length]!} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="text-small font-semibold text-foreground">{item.q}</span>
                    </span>
                    <span className="truncate text-xs text-text-3">{ASKERS[i % ASKERS.length]} · поднял(а) руку</span>
                  </span>
                  <Hand
                    className={cn("size-4 shrink-0 origin-bottom text-warning transition-transform duration-200 ease-ds", on && "-rotate-12")}
                    aria-hidden
                  />
                </button>
                <div
                  className="grid transition-[grid-template-rows] duration-500 ease-ds"
                  style={{ gridTemplateRows: on ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className={cn("flex flex-col gap-[3px] px-2.5 pb-4 pl-[58px] pt-2 transition-opacity duration-500", on ? "opacity-100" : "opacity-0")}>
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-foreground">Марина Петровна</span>
                        <span className="inline-flex h-[18px] items-center rounded-full bg-primary-light px-[7px] text-[11px] font-semibold text-primary">
                          учитель
                        </span>
                      </span>
                      <span className="max-w-[60ch] self-start rounded-md bg-primary-light px-3 py-2.5 text-small text-foreground">
                        {item.a}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
