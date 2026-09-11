import { Quote } from "lucide-react";

import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const ITEMS = [
  {
    quote:
      "Раньше у нас было три сервиса и инструкция для родителей на страницу. Теперь ученику приходит одна ссылка, и он в классе за десять секунд.",
    name: "Ирина К.",
    role: "Руководитель онлайн-школы",
    initials: "ИК",
  },
  {
    quote:
      "Редактор материалов — то, ради чего мы перешли. Методисты собирают проверочные сами, без вёрстки, а движок считает баллы за меня.",
    name: "Дмитрий С.",
    role: "Методист по математике",
    initials: "ДС",
  },
  {
    quote:
      "Доска и слайды в одном холсте изменили сам формат урока. Дети пишут у доски по очереди, я вижу, кто отвечает — не гадаю по чёрному экрану.",
    name: "Марина В.",
    role: "Учитель русского языка",
    initials: "МВ",
  },
];

export function Testimonials() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="container-l">
        <SectionHeading eyebrow="Отзывы" title="За это платформу и любят" />

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {ITEMS.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <figure className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
                <Quote className="size-7 text-primary-muted" />
                <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-foreground">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                  <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-primary to-teal text-[13px] font-bold text-white">
                    {t.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-heavy text-foreground">
                      {t.name}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
