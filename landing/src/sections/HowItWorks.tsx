import { CalendarPlus, Link2, PlayCircle } from "lucide-react";

import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const STEPS = [
  {
    icon: CalendarPlus,
    n: "01",
    title: "Создайте урок",
    text: "Название, учитель, настройки класса. Комната остаётся постоянной — ссылка не протухает.",
  },
  {
    icon: Link2,
    n: "02",
    title: "Пришлите ссылку ученикам",
    text: "Одна ссылка на весь класс. Ученик вводит имя, проходит проверку камеры и микрофона — и в уроке.",
  },
  {
    icon: PlayCircle,
    n: "03",
    title: "Ведите урок",
    text: "Доска, слайды, задания, запись — переключаются на лету для всех. Готовьтесь один раз, повторяйте сколько нужно.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="container-l">
        <SectionHeading
          eyebrow="Как это работает"
          title={<>От «создать» до «вести урок» — <span className="whitespace-nowrap">три шага</span></>}
        />

        <div className="relative mt-14 grid gap-4 sm:grid-cols-3">
          {/* соединительная линия */}
          <div className="pointer-events-none absolute left-0 right-0 top-11 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent sm:block" />

          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <article className="relative h-full rounded-2xl border border-border bg-card p-6 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_12px_30px_-8px_rgba(29,78,216,0.5)]">
                  <s.icon className="size-6" />
                </div>
                <span className="mt-4 block font-mono text-[12px] font-bold tracking-widest text-primary">
                  {s.n}
                </span>
                <h3 className="mt-1 text-[17px] font-heavy tracking-head text-foreground">{s.title}</h3>
                <p className="mx-auto mt-2 max-w-[34ch] text-[14px] leading-relaxed text-muted-foreground">
                  {s.text}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
