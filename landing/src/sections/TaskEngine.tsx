import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Mark, Words } from "@/components/Ink";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { useReveal } from "@/hooks/useReveal";
import { LBadge } from "@/lesson/parts";

const TYPES = [
  "Выбор одного",
  "Выбор нескольких",
  "Верно / неверно",
  "Ввод текста",
  "Числовой ответ с допуском",
  "Развёрнутый ответ + рубрика",
  "Пропуски: выпадающий список",
  "Пропуски: ввод",
  "Соотнесение",
  "Упорядочивание",
  "Классификация",
  "Перетащить слова",
  "Точка на изображении",
  "Начерти на холсте",
  "Ответ на числовой прямой",
  "Соединить линиями",
  "Уравнять реакцию",
  "Построить график",
  "Ответ формулой",
  "Загрузить фото решения",
  "Запись голоса",
  "Кроссворд · сканворд",
];

const PILLARS = [
  {
    title: "Редактор для методиста",
    text: "Конструктор в духе Notion: команда «/», карточки-заготовки, живое превью «как видит ученик», версии и ревью.",
  },
  {
    title: "Проверка на сервере",
    text: "Допуски absolute/relative/percent, регэкспы, опечатки, единицы измерения. Частичные баллы. Ключи не текут на клиент.",
  },
  {
    title: "Импорт из Word и PDF",
    text: "Загрузите документ с вопросами — платформа разберёт его в блоки материала. Дальше правьте в редакторе.",
  },
];

const OPTION_ROW =
  "flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2.5 text-sm transition-colors duration-300";
const RADIO = "size-4 shrink-0 accent-[hsl(var(--primary))]";

/** Карточка вопроса — QuestionPlayer: рамка, prompt, бейдж баллов, варианты. Ответ «выбирается сам» при появлении. */
function QuestionCard({
  prompt,
  points,
  delay,
  children,
}: {
  prompt: string;
  points: string;
  delay: number;
  children: (on: boolean) => React.ReactNode;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>({ threshold: 0.5 });
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setOn(true), delay + 700);
    return () => clearTimeout(t);
  }, [visible, delay]);
  return (
    <div
      ref={ref}
      data-visible={visible}
      className="reveal lesson-ui rounded-lg border border-border bg-card p-4"
      style={{ ["--reveal-delay" as string]: `${delay}ms` } as React.CSSProperties}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="text-sm">
          <p className="my-1">{prompt}</p>
        </div>
        <LBadge variant="muted" className="shrink-0">
          {points}
        </LBadge>
      </div>
      <div className="mt-3">{children(on)}</div>
    </div>
  );
}

function Radio({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className={cn(OPTION_ROW, checked && "border-primary/40 bg-accent")}>
      <input type="radio" readOnly checked={checked} tabIndex={-1} className={RADIO} />
      <span>{label}</span>
    </label>
  );
}

function Check({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className={cn(OPTION_ROW, checked && "border-primary/40 bg-accent")}>
      <input type="checkbox" readOnly checked={checked} tabIndex={-1} className={cn(RADIO, "rounded")} />
      <span>{label}</span>
    </label>
  );
}

export function TaskEngine() {
  return (
    <section id="tasks" className="relative py-24 sm:py-32">
      <div className="container-l">
        <SectionHeading
          title={
            <>
              Второй продукт <Mark d={400}>внутри</Mark> первого
            </>
          }
          subtitle="Не тест из трёх кнопок, а конструктор проверочных, разборов и домашних работ по любому предмету 1–11 класса."
        />

        {/* Настоящие карточки вопросов из плеера ученика */}
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <QuestionCard prompt="Сократите дробь 12/18." points="1 балл" delay={0}>
            {(on) => (
              <div className="flex flex-col gap-0.5">
                {["1/2", "2/3", "3/4", "4/9"].map((o, i) => (
                  <Radio key={o} label={o} checked={on && i === 1} />
                ))}
              </div>
            )}
          </QuestionCard>

          <QuestionCard prompt="Какие числа простые?" points="2 балла" delay={120}>
            {(on) => (
              <div className="flex flex-col gap-0.5">
                {["7", "9", "11", "15"].map((o, i) => (
                  <Check key={o} label={o} checked={on && (i === 0 || i === 2)} />
                ))}
              </div>
            )}
          </QuestionCard>

          <QuestionCard prompt="Найдите длину гипотенузы при катетах 3 и 4." points="2 балла" delay={240}>
            {(on) => (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-10 w-32 items-center rounded-md border border-border bg-card px-3.5 text-[15px] text-foreground shadow-xs">
                  <span className={cn("transition-opacity duration-500", on ? "opacity-100" : "opacity-0")}>5</span>
                </span>
                <span className="text-xs text-muted-foreground">единицы</span>
                <span className="flex h-10 w-24 items-center rounded-md border border-border bg-card px-3.5 text-[15px] text-foreground shadow-xs">
                  <span className={cn("transition-opacity duration-500 delay-300", on ? "opacity-100" : "opacity-0")}>см</span>
                </span>
              </div>
            )}
          </QuestionCard>
        </div>

        {/* Все 22 типа — сплошным текстом, как в конспекте */}
        <Reveal className="mt-20 max-w-4xl">
          <p className="text-[24px] font-bold leading-[1.5] tracking-tight text-foreground sm:text-[32px]">
            {TYPES.map((t, i) => (
              <span
                key={t}
                className="cursor-default transition-colors duration-300 hover:text-primary hover:[text-shadow:0_0_0_currentColor]"
                style={{ transitionDelay: "0ms" }}
              >
                {t}
                {i < TYPES.length - 1 ? <span className="mx-2 text-foreground/15 sm:mx-3">/</span> : "."}
              </span>
            ))}
          </p>
          <p className="mt-4 text-[15px] text-muted-foreground">22 типа. Наведите на любой — он подсветится.</p>
        </Reveal>

        <div className="mt-20 grid gap-x-10 gap-y-10 border-t border-foreground pt-8 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 90}>
              <Words as="h3" step={35} className="text-[20px] font-black tracking-tightest">
                {p.title}
              </Words>
              <p className="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-muted-foreground">{p.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
