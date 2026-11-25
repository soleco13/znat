import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Reveal } from "@/components/Reveal";
import { useMedia } from "@/hooks/useMedia";
import { DESKTOP_H, DESKTOP_W, FitBox, PHONE_H, PHONE_W, PhoneWindow, RoomWindow } from "@/lesson/RoomWindow";
import { Layout } from "@/site/Layout";
import { APP, ARTICLES } from "@/lib/site";

/**
 * Онлайн-доска (/doska) — под запросы «онлайн доска для репетитора», «доска
 * онлайн для уроков» (docs/seo/02-demand-map.md). Только то, что есть в
 * уроке: apps/web/src/features/canvas (листы, фоны, слайды, фото, права).
 */
export function DoskaPage() {
  return (
    <Layout page="doska">
      <Hero />
      <Board />
      <Tools />
      <Control />
      <Subjects />
      <Questions />
      <Closing />
    </Layout>
  );
}

const link =
  "font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4 transition-colors hover:decoration-primary";

function Hero() {
  return (
    <section className="pb-14 pt-12 sm:pb-20 sm:pt-20">
      <div className="container-l">
        <div className="hero-in max-w-[760px]">
          <h1 className="text-hero text-foreground">Онлайн-доска для уроков с&nbsp;учеником</h1>
          <p className="mt-6 max-w-[40em] text-body text-text-2 sm:text-lead">
            Доска открыта в том же окне, что видео и слайды. Ученик переходит по ссылке и рисует вместе с вами —
            без регистрации, установки и второго сервиса.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <a data-umami-event="Начать бесплатно" data-umami-event-place="доска, первый экран" href={APP.register} className={cn(buttonVariants({ size: "cta" }), "group")}>
              Начать бесплатно
              <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </a>
            <a href="/pricing" className={cn(buttonVariants({ variant: "quiet", size: "cta" }), "self-start px-0 sm:self-auto")}>
              Тарифы
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Та же доска, что в уроке, — копия интерфейса (src/lesson/*), сцена «Доска». */
function Board() {
  const desktop = useMedia("(min-width: 768px)", true);
  return (
    <section aria-label="Доска в уроке" className="border-t border-border bg-card py-14 sm:py-20">
      <div className="container-l">
        <div className="overflow-hidden rounded-lg border border-border bg-background shadow-md" aria-hidden>
          {desktop ? (
            <FitBox width={DESKTOP_W} height={DESKTOP_H} maxScale={1}>
              <RoomWindow scene="board" />
            </FitBox>
          ) : (
            <FitBox width={PHONE_W} height={PHONE_H}>
              <PhoneWindow scene="board" />
            </FitBox>
          )}
        </div>
        <p className="mt-5 max-w-[60ch] text-small text-text-2">
          Интерфейс урока без монтажа: видео учеников сбоку, доска в центре, инструменты слева.
        </p>
      </div>
    </section>
  );
}

const TOOLS = [
  {
    title: "Несколько листов",
    text: "Новый лист — для новой задачи. Прошлые остаются рядом, к ним можно вернуться в любой момент урока.",
  },
  {
    title: "Клетка, линейка, координаты, ноты",
    text: "Фон выбирается для каждого листа: пустой, в клетку, в линейку, координатная плоскость или нотный стан.",
  },
  {
    title: "Слайды из PDF и PowerPoint",
    text: "Загрузите презентацию или PDF — каждый слайд станет листом доски, и на нём можно рисовать. По слайдам работает поиск.",
  },
  {
    title: "Фото на доску",
    text: "Снимок страницы учебника или тетради ученика ложится на лист. Подходят PNG, JPEG и WebP.",
  },
  {
    title: "Карандаш, фигуры, текст",
    text: "Линии, стрелки, прямоугольники, эллипсы, текст, ластик. Ошибку можно отменить, лист — сдвинуть рукой.",
  },
];

function Tools() {
  return (
    <section aria-labelledby="tools-title" className="py-20 sm:py-28">
      <div className="container-l grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <h2 id="tools-title" className="max-w-[14ch] text-h2 text-foreground lg:sticky lg:top-28 lg:self-start">
          Что есть на&nbsp;доске
        </h2>
        <ul className="border-t border-foreground">
          {TOOLS.map((t, i) => (
            <Reveal as="li" key={t.title} delay={i * 60} className="grid gap-3 border-b border-border py-8 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-10">
              <h3 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground">{t.title}</h3>
              <p className="text-body text-text-2">{t.text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Control() {
  return (
    <section aria-labelledby="control-title" className="border-t border-border bg-card py-20 sm:py-28">
      <div className="container-l">
        <h2 id="control-title" className="max-w-[18ch] text-h2 text-foreground">
          Кто рисует, решаете вы
        </h2>
        <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h3 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground">Всем или одному</h3>
            <p className="mt-3 max-w-[46ch] text-body text-text-2">
              Сначала рисует только учитель. Одной кнопкой откройте доску всему классу или ученику, который решает.
            </p>
          </div>
          <div>
            <h3 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground">Следовать за учителем</h3>
            <p className="mt-3 max-w-[46ch] text-body text-text-2">
              Ученик включает режим в меню доски и видит тот же лист, что и вы.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const SUBJECTS = [
  { title: "Математика и физика", text: "Клетка для вычислений, координатная плоскость для графиков, фото задачи из учебника." },
  { title: "Языки", text: "Лист в линейку для письма, слайды с упражнениями из PowerPoint, текст прямо на слайде." },
  { title: "Музыка", text: "Нотный стан как фон листа: ноты, пометки и разбор фразы рисуются прямо поверх линеек." },
];

function Subjects() {
  return (
    <section aria-labelledby="subjects-title" className="py-20 sm:py-28">
      <div className="container-l">
        <h2 id="subjects-title" className="text-h2 text-foreground">
          Для каких предметов
        </h2>
        <dl className="mt-12 grid gap-x-16 gap-y-10 border-t border-border pt-10 md:grid-cols-3">
          {SUBJECTS.map((s) => (
            <div key={s.title} className="max-w-[34ch]">
              <dt className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground">{s.title}</dt>
              <dd className="mt-3 text-body text-text-2">{s.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Questions() {
  const guide = ARTICLES.find((a) => a.id === "guide")!;
  const items = [
    {
      q: "Нужно ли ученику регистрироваться?",
      a: <>Нет. Ученик открывает ссылку на урок, вводит имя и сразу видит доску. Аккаунт и установка не нужны.</>,
    },
    {
      q: "Чем это отличается от отдельной онлайн-доски?",
      a: (
        <>
          Отдельную доску открывают рядом с Zoom или Телемостом, и ученику приходят две ссылки. Здесь видео, доска и
          слайды — в одной вкладке, ученик не переключается между окнами.
        </>
      ),
    },
    {
      q: "Работает ли доска на планшете и телефоне?",
      a: <>Да, урок открывается в браузере на компьютере, планшете и телефоне. На телефоне инструменты собраны в панель сбоку.</>,
    },
    {
      q: "Сколько стоит?",
      a: (
        <>
          Доска есть на всех тарифах. «Старт» бесплатный и без срока — до 3 учеников в уроке. «Репетитор» — 790 ₽ в
          месяц: до 8 учеников и запись уроков.{" "}
          <a href="/pricing" className={link}>
            Все тарифы
          </a>
          .
        </>
      ),
    },
    {
      q: "Как подготовить первый онлайн-урок?",
      a: (
        <>
          Собрали советы о технике, материалах и первом занятии в статье{" "}
          <a href={guide.href} className={link}>
            «{guide.label}»
          </a>
          .
        </>
      ),
    },
  ];
  return (
    <section aria-labelledby="faq-title" className="border-t border-border pb-20 pt-20 sm:pb-28 sm:pt-28">
      <div className="container-l">
        <h2 id="faq-title" className="text-h2 text-foreground">
          Частые вопросы
        </h2>
        <dl className="mt-12 max-w-[760px] border-t border-foreground">
          {items.map((n) => (
            <div key={n.q} className="grid gap-2 border-b border-border py-7 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-10">
              <dt className="font-bold text-foreground">{n.q}</dt>
              <dd className="text-small text-text-2">{n.a}</dd>
            </div>
          ))}
        </dl>
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
            Попробуйте доску на&nbsp;следующем уроке
          </h2>
          <p className="mt-5 text-body text-text-2">
            Регистрация — пара минут. Затем отправьте ученику постоянную ссылку на урок.
          </p>
        </div>
        <a data-umami-event="Начать бесплатно" data-umami-event-place="доска, конец" href={APP.register} className={cn(buttonVariants({ size: "cta" }), "shrink-0 self-start lg:self-auto")}>
          Начать бесплатно
        </a>
      </div>
    </section>
  );
}
