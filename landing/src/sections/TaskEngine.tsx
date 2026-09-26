import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";
import { useReveal } from "@/hooks/useReveal";
import { LBadge } from "@/lesson/parts";

const TYPES = [
  "Выбор одного",
  "Выбор нескольких",
  "Верно / неверно",
  "Ввод текста",
  "Ответ числом",
  "Развёрнутый ответ",
  "Выбрать слово в пропуске",
  "Вписать пропущенное",
  "Соотнесение",
  "Упорядочивание",
  "Разложить по группам",
  "Перетащить слова",
  "Отметить на картинке",
  "Начерти на холсте",
  "Ответ на числовой прямой",
  "Соединить линиями",
  "Уравнять реакцию",
  "Построить график",
  "Написать формулу",
  "Загрузить фото решения",
  "Запись голоса",
  "Кроссворд · сканворд",
];

const PILLARS = [
  {
    title: "Собирается как конструктор",
    text: "Выбрали шаблон, вписали вопрос — готово. Сразу видно, как задание увидит ученик. Справится любой учитель, не только методист.",
  },
  {
    title: "Проверяет по-честному",
    text: "Засчитает «5 см» и «5 сантиметров», простит опечатку, даст баллы за частично верный ответ. А подсмотреть правильные ответы ученик не сможет.",
  },
  {
    title: "Импорт из Word и PDF",
    text: "Уже есть задания в документах? Загрузите файл — вопросы сами разложатся по карточкам. Годы наработок не пропадут.",
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
  // Через мгновение после ответа платформа «проверяет» работу: красная галочка + баллы.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t1 = setTimeout(() => setOn(true), delay + 700);
    const t2 = setTimeout(() => setChecked(true), delay + 1800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
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
        <span className="flex shrink-0 items-center gap-1.5">
          <CheckTick drawn={checked} />
          <LBadge variant={checked ? "green" : "muted"} className={cn("transition-colors duration-300", checked && "text-success-ink")}>
            {checked ? `Верно · ${points}` : points}
          </LBadge>
        </span>
      </div>
      <div className="mt-3">{children(on)}</div>
    </div>
  );
}

/** Галочка учительским красным карандашом — прорисовывается штрихом, когда ответ проверен. */
function CheckTick({ drawn }: { drawn: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 20" className="h-4 w-5 overflow-visible">
      <path
        d="M2 11 C 4 13, 6 15.5, 8.5 18 C 12 11, 16.5 5.5, 22.5 1.5"
        fill="none"
        stroke="#e03131"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 32,
          strokeDashoffset: drawn ? 0 : 32,
          transition: "stroke-dashoffset 450ms var(--ease)",
        }}
      />
    </svg>
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
          title="Задания, которые проверяются сами"
          subtitle="Тесты, самостоятельные и домашние работы по любому предмету с 1 по 11 класс. Вы тратите время на объяснение, а не на проверку тетрадей."
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
              <span key={t}>
                {t}
                {i < TYPES.length - 1 ? <span className="mx-2 text-text-3 sm:mx-3" aria-hidden>/</span> : "."}
              </span>
            ))}
          </p>
          <p className="mt-4 text-small text-muted-foreground">22 вида заданий.</p>
        </Reveal>

        <div className="mt-20 grid gap-x-10 gap-y-10 border-t border-foreground pt-8 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 90}>
              <h3 className="text-lead font-bold tracking-tight">{p.title}</h3>
              <p className="mt-3 max-w-[38ch] text-small text-muted-foreground">{p.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
