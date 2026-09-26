import { ArrowRight, Eraser, ImagePlus, MousePointer2, Pencil as PencilIcon, Redo2, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { LBadge, RecordingPill, StatusPill, Tile } from "@/lesson/parts";
import { PEOPLE } from "@/lesson/data";

/** Каждая строка — возможность + живой кусочек интерфейса урока (те же компоненты, что в комнате). */
const ROWS: {
  title: string;
  text: string;
  fragment: React.ReactNode;
}[] = [
  {
    title: "Видео до 30 учеников",
    text: "Картинка не зависает даже при слабом интернете — качество подстраивается само. Никаких ограничений по минутам: урок идёт столько, сколько нужно.",
    fragment: (
      <div className="flex gap-2">
        {PEOPLE.slice(1, 5).map((p, i) => (
          <Tile
            key={p.id}
            name={p.name}
            size="xs"
            className="aspect-[3/4] w-[64px] shrink-0"
            video={p.video}
            hand={p.hand}
            speaking={i === 1}
          />
        ))}
      </div>
    ),
  },
  {
    title: "Общая доска",
    text: "Пишите и рисуйте вместе с учениками прямо поверх презентации. Вы решаете, кому можно выйти «к доске», — порядок гарантирован.",
    fragment: (
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm">
        {[MousePointer2, PencilIcon, Eraser, ImagePlus, Undo2, Redo2].map((I, i) => (
          <span
            key={i}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg text-text-2 transition-colors duration-300 [&_svg]:size-[19px]",
              i === 1 && "bg-primary-light text-primary",
            )}
          >
            <I aria-hidden />
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Задания прямо на уроке",
    text: "22 вида заданий — от теста до «начерти график». Платформа сама проверит ответы и сразу покажет, кто справился, а кому нужна помощь.",
    fragment: (
      <div className="flex flex-wrap gap-2 text-xs lg:justify-end">
        <LBadge variant="green" className="py-0.5">9 ответили</LBadge>
        <LBadge variant="blue">2 в работе</LBadge>
        <LBadge variant="yellow">1 застрял</LBadge>
        <LBadge variant="gray">2 не начали</LBadge>
      </div>
    ),
  },
  {
    title: "Презентации без «демонстрации экрана»",
    text: "Загрузите презентацию PowerPoint или PDF — ученики увидят её чётко, без размытого текста и зависаний.",
    fragment: (
      <div className="lesson-ui flex flex-col items-start gap-1.5">
        <div className="flex items-center" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="flex items-center justify-center p-1.5">
              <span
                className={cn(
                  "h-1.5 rounded-full",
                  i === 2 ? "w-6 bg-primary" : "w-3 bg-border",
                )}
              />
            </span>
          ))}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">Слайд 3 из 14</span>
      </div>
    ),
  },
  {
    title: "Запись урока",
    text: "Одна кнопка — и урок записан вместе с доской. Запись лежит рядом с уроком: удобно для тех, кто заболел или хочет повторить.",
    fragment: (
      <div className="lesson-ui flex items-center gap-2">
        <StatusPill />
        <RecordingPill />
      </div>
    ),
  },
  {
    title: "Ученик — по ссылке",
    text: "Ученику не нужны аккаунт, пароль и программы. Открыл ссылку, ввёл имя — и уже на уроке. Даже с телефона.",
    fragment: (
      <div className="lesson-ui flex flex-col gap-1.5">
        <span className="truncate font-mono text-[12.5px] text-text-3">matis.online/j/8k2-xq</span>
        <span className="inline-flex items-center gap-2">
          <span className="flex h-10 w-40 items-center rounded-md border border-border bg-card px-3.5 text-[15px] text-muted-foreground shadow-xs">
            Ваше имя
          </span>
          <span className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[15px] font-semibold text-primary-foreground shadow-xs">
            Войти <ArrowRight className="size-4" />
          </span>
        </span>
      </div>
    ),
  },
];

export function Features() {
  return (
    <section id="features" className="relative border-y border-border bg-white py-24 sm:py-32">
      <div className="container-l">
        <SectionHeading
          title="Всё для урока — в&nbsp;одном окне"
          subtitle="Не нужно собирать урок из пяти сервисов и объяснять ученикам, куда нажимать. Всё уже здесь и работает вместе."
        />

        <ul className="mt-16 border-t border-foreground">
          {ROWS.map((r, i) => (
            <li key={r.title} className="group relative border-b border-border transition-colors duration-200 hover:bg-background">
              <Reveal delay={i * 40} className="grid gap-5 py-9 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_320px] lg:items-center lg:gap-12 lg:px-2">
                <h3 className="text-h3">{r.title}</h3>
                <p className="max-w-md text-small text-muted-foreground">{r.text}</p>
                <div className="lesson-ui lg:justify-self-end">{r.fragment}</div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
