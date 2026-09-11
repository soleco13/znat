import { CheckCircle2, FileInput, Wand2 } from "lucide-react";

import { Marquee } from "@/components/Marquee";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

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
    icon: Wand2,
    title: "Редактор для методиста",
    text: "Конструктор в духе Notion: команда «/», карточки-заготовки, живое превью «как видит ученик», версии и ревью.",
  },
  {
    icon: CheckCircle2,
    title: "Проверка на сервере",
    text: "Допуски absolute/relative/percent, регэкспы, опечатки, единицы измерения. Частичные баллы. Ключи не текут на клиент.",
  },
  {
    icon: FileInput,
    title: "Импорт из Word и PDF",
    text: "Загрузите документ с вопросами — платформа разберёт его в блоки материала. Дальше правьте в редакторе.",
  },
];

export function TaskEngine() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="container-l">
        <SectionHeading
          eyebrow="Движок заданий"
          title="Второй продукт внутри первого"
          subtitle="Не тест из трёх кнопок, а конструктор проверочных, разборов и домашних работ по любому предмету 1–11 класса."
        />

        <Reveal className="mt-12 space-y-3">
          <Marquee durationSec={50}>
            {TYPES.slice(0, 11).map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </Marquee>
          <Marquee durationSec={44} reverse>
            {TYPES.slice(11).map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </Marquee>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <article className="h-full rounded-2xl border border-border bg-card p-6">
                <div className="grid size-10 place-items-center rounded-xl bg-teal-light text-teal">
                  <p.icon className="size-5" />
                </div>
                <h3 className="mt-4 text-[16px] font-heavy tracking-head text-foreground">{p.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{p.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-[13.5px] font-medium text-foreground shadow-xs">
      <span className="grid size-4 place-items-center rounded-[5px] bg-primary-light text-[9px] font-bold text-primary">
        ?
      </span>
      {children}
    </span>
  );
}
