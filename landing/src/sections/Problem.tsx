import { useEffect, useState } from "react";
import { GraduationCap, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Strike } from "@/components/Ink";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { useReveal } from "@/hooks/useReveal";

const TABS = [
  { name: "Zoom — видео", c: "#2d8cff" },
  { name: "Miro — доска", c: "#f5b800" },
  { name: "Google Формы", c: "#7248b9" },
  { name: "PDF со слайдами", c: "#e03131" },
  { name: "Запись экрана", c: "#0d9488" },
  { name: "Чат класса", c: "#16a34a" },
];

const ROWS = [
  {
    before: "Zoom для видео, Miro для доски, Google Формы для теста",
    after: "Видео, доска, слайды, задания и чат — в одном окне урока",
  },
  {
    before: "Ученик ставит три программы и всё равно «меня не слышно»",
    after: "Ученик открывает ссылку и сразу в классе",
  },
  {
    before: "Демонстрация экрана вместо слайдов — текст расплывается",
    after: "Презентация видна чётко, и на ней можно рисовать"
  },
  {
    before: "Ответы собираются вручную после урока",
    after: "Класс отвечает — учитель видит прогресс вживую",
  },
  {
    before: "Запись — отдельный сервис и отдельная оплата",
    after: "Запись включается одной кнопкой и хранится рядом с уроком",
  },
];

/** Шесть вкладок «схлопываются» в одну — при появлении блока в поле зрения. */
function TabStrip() {
  const { ref, visible } = useReveal<HTMLDivElement>({ threshold: 0.7 });
  const [merged, setMerged] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setMerged(true), 1300);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <div ref={ref} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-end gap-1 border-b border-border bg-surface-3 px-2.5 pt-2.5">
        {TABS.map((t, i) => (
          <span
            key={t.name}
            className={cn(
              "flex h-9 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-t-[10px] bg-card text-[13px] font-medium text-text-2 transition-[max-width,padding,opacity,flex-grow] duration-700 ease-ds",
              merged ? "max-w-0 px-0 opacity-0" : "max-w-[200px] px-3 opacity-100",
            )}
            style={{ transitionDelay: merged ? `${i * 90}ms` : "0ms", flex: merged ? "0 1 0px" : "1 1 0px" }}
          >
            <span className="size-3 shrink-0 rounded-[4px]" style={{ background: t.c }} />
            <span className="truncate">{t.name}</span>
            <X className="ml-auto size-3 shrink-0 text-text-3" aria-hidden />
          </span>
        ))}
        <span
          className={cn(
            "flex h-9 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-t-[10px] bg-card px-3 text-[13px] font-semibold text-foreground transition-[max-width,padding,opacity,flex-grow] duration-700 ease-ds",
            merged ? "max-w-[260px] flex-[1_1_0px]" : "max-w-0 flex-[0_1_0px] px-0 opacity-0",
          )}
          style={{ transitionDelay: merged ? "500ms" : "0ms" }}
        >
          <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
            <GraduationCap className="size-3" aria-hidden />
          </span>
          Матис
        </span>
      </div>
      <div className="px-5 py-7 sm:px-8">
        <p
          className={cn(
            "text-small transition-colors duration-700 ease-ds",
            merged ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {merged ? "Одна вкладка. Один урок." : "Урок начался, а нужные окна ещё открываются…"}
        </p>
      </div>
    </div>
  );
}

export function Problem() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-l">
        <SectionHeading
          title="Урок не должен начинаться со слов «сейчас, я найду вкладку»"
          subtitle="Каждый сервис по отдельности хорош. Но вместе они съедают первые десять минут урока и внимание учеников. А родители платят за полный час."
        />

        <Reveal className="mt-14 max-w-3xl">
          <TabStrip />
        </Reveal>

        <ul className="mt-16 max-w-4xl divide-y divide-border border-y border-border">
          {ROWS.map((r, i) => (
            <li key={i} className="grid gap-2 py-6 sm:grid-cols-2 sm:gap-10">
              <p className="text-body text-muted-foreground">
                <Strike d={i * 120}>{r.before}</Strike>
              </p>
              <Reveal delay={350 + i * 120}>
                <p className="text-body font-semibold text-foreground">{r.after}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
