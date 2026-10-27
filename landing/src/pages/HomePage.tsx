import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Reveal } from "@/components/Reveal";
import { useMedia } from "@/hooks/useMedia";
import { DESKTOP_H, DESKTOP_W, FitBox, PHONE_H, PHONE_W, PhoneWindow, RoomWindow, type Scene } from "@/lesson/RoomWindow";
import { MarkScene } from "@/mark3d/MarkScene";
import { Layout } from "@/site/Layout";
import { APP, DEMO_HREF } from "@/lib/site";

export function HomePage() {
  return (
    <Layout page="home">
      <Hero />
      <Demo />
      <Reasons />
      <Closing />
    </Layout>
  );
}

function Hero() {
  return (
    <section className="overflow-clip">
      <div className="container-l grid items-center gap-x-10 gap-y-4 pb-16 pt-8 sm:pt-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:pb-24 lg:pt-16">
        <div className="hero-in max-w-[620px]">
          <h1 className="text-hero text-foreground">
            <span className="whitespace-nowrap">Онлайн-урок</span> в&nbsp;одной вкладке
          </h1>
          <p className="mt-5 max-w-[34em] text-body text-text-2 sm:mt-6 sm:text-lead">
            Видеосвязь, доска, слайды и задания с автопроверкой для репетиторов и онлайн-школ. Ученик открывает
            ссылку и сразу попадает на урок, без регистрации и установки.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <a href={APP.register} className={cn(buttonVariants({ size: "cta" }), "group")}>
              Начать бесплатно
              <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </a>
            <a href={DEMO_HREF} className={cn(buttonVariants({ variant: "quiet", size: "cta" }), "self-start px-0 sm:self-auto")}>
              Демонстрация для школы
            </a>
          </div>
          <p className="mt-6 text-small text-text-3">
            «Старт» бесплатный и без срока. Платные тарифы от 790&nbsp;₽ в месяц,{" "}
            <a href="/pricing" className="font-semibold text-text-2 underline decoration-border decoration-2 underline-offset-4 transition-colors hover:text-foreground hover:decoration-primary">
              все тарифы
            </a>
            .
          </p>
        </div>

        <MarkScene className="mx-auto w-full max-w-[300px] sm:max-w-[400px] lg:max-w-[540px]" />
      </div>
    </section>
  );
}

const SCENES: { id: Scene; label: string; caption: string }[] = [
  {
    id: "people",
    label: "Класс",
    caption: "Видео всего класса. В режиме «Лекция» ученики слышат учителя, а слово получают по поднятой руке.",
  },
  {
    id: "board",
    label: "Доска",
    caption: "Общая доска с несколькими страницами. Рисовать на ней учитель разрешает всем ученикам сразу или кому-то одному.",
  },
  {
    id: "task",
    label: "Задание",
    caption: "Ученики решают задание прямо в уроке, ответы проверяются автоматически.",
  },
  {
    id: "progress",
    label: "Прогресс",
    caption: "Учитель видит, кто уже решил, кто ещё думает и кому нужна помощь.",
  },
];

/** Окно урока — копия интерфейса приложения (src/lesson/*); вкладки переключают сцены. */
function Demo() {
  const desktop = useMedia("(min-width: 768px)", true);
  const [scene, setScene] = useState<Scene>("board");
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = SCENES.find((s) => s.id === scene)!;

  // Стрелки переключают вкладки (WAI-ARIA tabs): фокус переезжает вместе с выбором.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SCENES.findIndex((s) => s.id === scene);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? SCENES.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const s = SCENES[(next + SCENES.length) % SCENES.length]!;
    setScene(s.id);
    tabs.current[s.id]?.focus();
  };

  return (
    <section aria-labelledby="demo-title" className="border-t border-border bg-card py-20 sm:py-28">
      <div className="container-l">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h2 id="demo-title" className="text-h2 text-foreground">
              Так выглядит урок
            </h2>
            <p className="mt-4 max-w-[46ch] text-body text-text-2">
              Это интерфейс Матиса без монтажа: те же плитки, доска и панель управления, что у учителя на уроке.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Что показать"
            onKeyDown={onKey}
            className="flex flex-wrap gap-0.5 sm:gap-1"
          >
            {SCENES.map((s) => {
              const on = s.id === scene;
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    tabs.current[s.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${s.id}`}
                  aria-selected={on}
                  aria-controls="demo-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setScene(s.id)}
                  className={cn(
                    "inline-flex h-11 shrink-0 cursor-pointer items-center rounded-md px-3 text-small font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4",
                    on ? "bg-foreground text-background" : "text-text-2 hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div id="demo-panel" role="tabpanel" aria-labelledby={`tab-${scene}`} className="mt-10">
          <p className="min-h-[3.2em] max-w-[60ch] text-small text-text-2 sm:min-h-0" aria-live="polite">
            {current.caption}
          </p>
          <div className="mt-5 overflow-hidden rounded-lg border border-border bg-background shadow-md" aria-hidden>
            {desktop ? (
              <FitBox width={DESKTOP_W} height={DESKTOP_H} maxScale={1}>
                <RoomWindow scene={scene} />
              </FitBox>
            ) : (
              <FitBox width={PHONE_W} height={PHONE_H}>
                <PhoneWindow scene={scene} />
              </FitBox>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const REASONS = [
  {
    title: "Ученик входит по ссылке",
    text: "Имя, проверка камеры и микрофона — и он в классе. Аккаунт, пароль и установка не нужны: урок открывается в браузере на компьютере, планшете и телефоне.",
  },
  {
    title: "Не нужно переключаться между сервисами",
    text: "Видео, доска, слайды и материалы открыты в одном окне. Учитель не рассылает три ссылки перед уроком, а ученик не теряется между вкладками.",
  },
  {
    title: "Задания проверяются сами",
    text: "Ученики отвечают прямо на уроке, а учитель сразу видит, кто справился. Правильные ответы ученик узнаёт только после того, как сдал работу.",
  },
];

function Reasons() {
  return (
    <section aria-labelledby="reasons-title" className="py-20 sm:py-28">
      <div className="container-l grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <h2 id="reasons-title" className="max-w-[14ch] text-h2 text-foreground lg:sticky lg:top-28 lg:self-start">
          Зачем урок в&nbsp;одном окне
        </h2>
        <ul className="border-t border-foreground">
          {REASONS.map((r, i) => (
            <Reveal as="li" key={r.title} delay={i * 80} className="grid gap-3 border-b border-border py-8 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-10">
              <h3 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground">{r.title}</h3>
              <p className="text-body text-text-2">{r.text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="closing-title" className="border-t border-border bg-card py-20 sm:py-28">
      <div className="container-l flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[620px]">
          <h2 id="closing-title" className="text-h2 text-foreground">
            Проведите следующий урок в Матисе
          </h2>
          <p className="mt-5 text-body text-text-2">
            Регистрация занимает пару минут, первый урок можно провести на бесплатном тарифе. Школам покажем
            платформу на их собственных материалах.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <a href={APP.register} className={buttonVariants({ size: "cta" })}>
            Начать бесплатно
          </a>
          <a href={DEMO_HREF} className={cn(buttonVariants({ variant: "quiet", size: "cta" }), "self-start px-0 sm:self-auto")}>
            Запросить демонстрацию
          </a>
        </div>
      </div>
    </section>
  );
}
