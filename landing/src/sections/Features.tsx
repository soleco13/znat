import {
  ArrowRight,
  ClipboardCheck,
  Disc,
  Link as LinkIcon,
  PenTool,
  Presentation,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const FEATURES = [
  {
    icon: Users,
    title: "Видео до 30 учеников",
    text: "Свой SFU-сервер: адаптивное качество, режимы «лекция» и «обсуждение», приоритет камере учителя. Никаких лимитов на минуты.",
    span: "sm:col-span-2",
  },
  {
    icon: PenTool,
    title: "Общая доска",
    text: "Рисуют одновременно, курсоры видны, права выдаёт учитель. Поверх слайдов и картинок.",
  },
  {
    icon: ClipboardCheck,
    title: "Движок заданий",
    text: "22 типа вопросов: от выбора ответа до «начерти на холсте». Автопроверка с допусками, очередь ручной проверки, разбор для класса.",
    span: "sm:col-span-2",
  },
  {
    icon: Presentation,
    title: "Слайды без демонстрации экрана",
    text: "Загрузите .pptx или .pdf — платформа сама превратит их в чёткие слайды с поиском по тексту.",
  },
  {
    icon: Disc,
    title: "Запись урока",
    text: "Одна кнопка. Готовый MP4 с доской и говорящим — рядом с уроком, со ссылкой на час.",
  },
  {
    icon: LinkIcon,
    title: "Ученик — по ссылке",
    text: "Без аккаунта, без установки, без пароля. Ввёл имя — и в классе. Личность живёт в пределах урока.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="container-l">
        <SectionHeading
          eyebrow="Возможности"
          title="Целая платформа, а&nbsp;не набор кнопок"
          subtitle="Каждый кусок — своя реализация, вкомпилированная в приложение. Не iframe чужих сервисов, которые могут отвалиться посреди урока."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80} className={cn("h-full", f.span)}>
              <article className="card-ring group flex h-full flex-col p-6">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <f.icon className="size-[22px]" />
                </div>
                <h3 className="mt-4 text-[17px] font-heavy tracking-head text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.text}</p>
              </article>
            </Reveal>
          ))}

          {/* CTA-плитка добивает 3×3 */}
          <Reveal delay={160} className="h-full">
            <a
              href="#pricing"
              className="group flex h-full flex-col justify-between rounded-xl bg-primary p-6 text-primary-foreground shadow-glow transition-transform duration-200 ease-ds hover:-translate-y-1"
            >
              <span className="text-[16px] font-heavy leading-snug">
                И это ещё не всё — чат, рука, режимы урока, роли
              </span>
              <span className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold">
                Посмотреть тариф
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
