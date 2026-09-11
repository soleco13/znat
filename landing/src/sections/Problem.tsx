import { ArrowRight, Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const BEFORE = [
  "Zoom для видео, Miro для доски, Google Формы для теста",
  "Ученик ставит 3 расширения и всё равно «меня не видно»",
  "Демонстрация экрана вместо слайдов — текст расплывается",
  "Ответы собираются вручную после урока",
  "Запись — отдельный сервис и отдельная оплата",
];

const AFTER = [
  "Видео, доска, слайды, задания и чат — в одном окне урока",
  "Ученик открывает ссылку и сразу в классе",
  "Слайды рендерятся чётко, поверх них можно писать",
  "Класс отвечает — учитель видит прогресс вживую",
  "Запись включается одной кнопкой, лежит рядом с уроком",
];

export function Problem() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="container-l">
        <SectionHeading
          eyebrow="Знакомо?"
          title={
            <>
              Урок не должен начинаться <br className="hidden sm:block" />
              со слов «сейчас, я найду вкладку»
            </>
          }
          subtitle="Каждый инструмент по отдельности хорош. Вместе они крадут первые десять минут урока и внимание учеников."
        />

        <div className="mx-auto mt-14 grid max-w-4xl gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <Reveal>
            <Panel
              tone="bad"
              title="Как обычно"
              items={BEFORE}
            />
          </Reveal>

          <Reveal delay={120} className="mx-auto hidden size-12 place-items-center rounded-full border border-border bg-card text-primary shadow-sm sm:grid">
            <ArrowRight className="size-5" />
          </Reveal>

          <Reveal delay={80}>
            <Panel tone="good" title="Со «Школой онлайн»" items={AFTER} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Panel({
  tone,
  title,
  items,
}: {
  tone: "bad" | "good";
  title: string;
  items: string[];
}) {
  const good = tone === "good";
  return (
    <div
      className={cn(
        "h-full rounded-2xl border p-5 sm:p-6",
        good
          ? "border-primary-muted bg-primary-light/40 shadow-glow"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full",
            good ? "bg-primary text-primary-foreground" : "bg-surface-3 text-text-3",
          )}
        >
          {good ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        </span>
        <span className={cn("text-[15px] font-heavy", good ? "text-primary" : "text-muted-foreground")}>
          {title}
        </span>
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-[14px] leading-snug">
            <span
              className={cn(
                "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
                good ? "bg-success/15 text-success" : "bg-danger/10 text-danger",
              )}
            >
              {good ? <Check className="size-2.5" /> : <X className="size-2.5" />}
            </span>
            <span className={good ? "text-foreground" : "text-muted-foreground"}>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
