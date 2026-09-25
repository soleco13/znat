import { ArrowRight, Eraser, ImagePlus, MousePointer2, Pencil as PencilIcon, Redo2, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Words } from "@/components/Ink";
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
    text: "Свой SFU-сервер: адаптивное качество, режимы «лекция» и «обсуждение», приоритет камере учителя. Никаких лимитов на минуты.",
    fragment: (
      <div className="flex gap-2">
        {PEOPLE.slice(1, 5).map((p, i) => (
          <Tile
            key={p.id}
            name={p.name}
            size="xs"
            className="aspect-[3/4] w-[64px] shrink-0 transition-transform duration-500 ease-ds group-hover:-translate-y-1.5"
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
    text: "Рисуют одновременно, курсоры видны, права выдаёт учитель. Поверх слайдов и картинок.",
    fragment: (
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm">
        {[MousePointer2, PencilIcon, Eraser, ImagePlus, Undo2, Redo2].map((I, i) => (
          <span
            key={i}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg text-text-2 transition-colors duration-300 [&_svg]:size-[19px]",
              i === 1 && "bg-primary-light text-primary",
              i === 3 && "group-hover:bg-primary-light group-hover:text-primary",
            )}
          >
            <I aria-hidden />
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Движок заданий",
    text: "22 типа вопросов: от выбора ответа до «начерти на холсте». Автопроверка с допусками и очередь ручной проверки.",
    fragment: (
      <div className="flex flex-wrap gap-2 text-xs">
        <LBadge variant="green" className="py-0.5">9 ответили</LBadge>
        <LBadge variant="blue">2 в работе</LBadge>
        <LBadge variant="yellow">1 застрял</LBadge>
        <LBadge variant="gray">2 не начали</LBadge>
      </div>
    ),
  },
  {
    title: "Слайды без демонстрации экрана",
    text: "Загрузите .pptx или .pdf — платформа сама превратит их в чёткие слайды с поиском по тексту.",
    fragment: (
      <div className="lesson-ui flex flex-col items-start gap-1.5">
        <div className="flex items-center" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="flex items-center justify-center p-1.5">
              <span
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500 ease-ds",
                  i === 2 ? "w-6 bg-primary" : "w-3 bg-border group-hover:w-4",
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
    text: "Одна кнопка. Готовый MP4 с доской и говорящим — рядом с уроком, со ссылкой на час.",
    fragment: (
      <div className="lesson-ui flex items-center gap-2">
        <StatusPill />
        <RecordingPill />
      </div>
    ),
  },
  {
    title: "Ученик — по ссылке",
    text: "Без аккаунта, без установки, без пароля. Ввёл имя — и в классе. Личность живёт в пределах урока.",
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
          title="Целая платформа, а&nbsp;не набор кнопок"
          subtitle="Каждый кусок — своя реализация, вкомпилированная в приложение. Не iframe чужих сервисов, которые могут отвалиться посреди урока."
        />

        <ul className="mt-16 border-t border-foreground">
          {ROWS.map((r, i) => (
            <li key={r.title} className="group relative border-b border-border transition-colors duration-500 hover:bg-background">
              <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-primary transition-transform duration-700 ease-ds group-hover:scale-x-100" />
              <Reveal delay={i * 40} className="grid gap-5 py-9 lg:grid-cols-[1.1fr_1fr_auto] lg:items-center lg:gap-12 lg:px-2">
                <Words as="h3" step={35} className="text-[26px] font-black leading-[1.1] tracking-tightest transition-transform duration-500 ease-ds group-hover:translate-x-2 sm:text-[34px]">
                  {r.title}
                </Words>
                <p className="max-w-md text-[15.5px] leading-relaxed text-muted-foreground">{r.text}</p>
                <div className="lesson-ui lg:min-w-[280px] lg:justify-self-end">{r.fragment}</div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
