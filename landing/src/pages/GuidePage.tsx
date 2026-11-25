import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Layout } from "@/site/Layout";
import { APP } from "@/lib/site";

/**
 * Статья «Как проводить онлайн-уроки» (/blog/kak-provodit-onlajn-uroki) —
 * под запросы «как проводить онлайн уроки», «…репетитору»
 * (docs/seo/02-demand-map.md). Советы общие, про Матис — только в конце и
 * только то, что есть в продукте.
 */
import { GUIDE_PUBLISHED } from "./guide-meta";

const link =
  "font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4 transition-colors hover:decoration-primary";

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "tehnika",
    title: "Техника: что проверить заранее",
    body: (
      <>
        <p>
          Большинство сорванных онлайн-уроков срываются не из-за методики, а из-за звука. Ученик простит размытую
          картинку, но не простит, если не слышит объяснение.
        </p>
        <ul>
          <li>
            <strong>Наушники с микрофоном.</strong> Даже простая проводная гарнитура лучше встроенного микрофона
            ноутбука: нет эха, меньше шума комнаты.
          </li>
          <li>
            <strong>Проводной интернет или место рядом с роутером.</strong> Для видеоурока хватает нескольких мегабит
            в секунду, но важна стабильность. Если связь проседает, первым выключайте своё видео, а не звук.
          </li>
          <li>
            <strong>Камера на уровне глаз, свет спереди.</strong> Окно за спиной превращает лицо в силуэт. Лампа или
            окно перед вами решает это бесплатно.
          </li>
          <li>
            <strong>Графический планшет — по желанию.</strong> Писать формулы мышью неудобно. Если пишете много,
            недорогой планшет окупается за пару недель уроков. Можно обойтись и фото тетради.
          </li>
        </ul>
        <p>Перед первым уроком проведите пробный звонок с другом: проверьте звук, камеру и показ материалов.</p>
      </>
    ),
  },
  {
    id: "materialy",
    title: "Материалы: подготовить до звонка",
    body: (
      <>
        <p>
          На очном уроке можно на ходу взять другой учебник. Онлайн каждая минута поиска файла — минута, когда ученик
          смотрит в пустой экран.
        </p>
        <ul>
          <li>Соберите задачи урока в один файл или презентацию — в порядке, в котором будете их давать.</li>
          <li>Добавьте запасные задачи: онлайн темп непредсказуем, ученик может решить всё быстрее.</li>
          <li>
            Подготовьте пустые листы под решения: в клетку для математики, в линейку для языков. Ученику проще писать,
            когда разметка уже есть.
          </li>
          <li>Ссылку на урок отправьте заранее — накануне или за час, а не в момент начала.</li>
        </ul>
      </>
    ),
  },
  {
    id: "pervyj-urok",
    title: "Первый урок: первые десять минут",
    body: (
      <>
        <p>Первое онлайн-занятие с новым учеником — это ещё и проверка связи. Заложите на неё время.</p>
        <ol>
          <li>Убедитесь, что ученик вас слышит и видит, а вы — его. Спросите прямо, не по кивку.</li>
          <li>
            Договоритесь о правилах: камера включена, если ученик не слышит — пишет в чат, если связь пропала —
            возвращается по той же ссылке.
          </li>
          <li>
            Покажите доску и дайте ученику что-нибудь нарисовать или написать. Пока он сам не попробовал инструменты,
            он будет стесняться ими пользоваться.
          </li>
          <li>Только после этого переходите к теме урока.</li>
        </ol>
      </>
    ),
  },
  {
    id: "vovlechenie",
    title: "Как удерживать внимание",
    body: (
      <>
        <p>
          Онлайн ученику легче отвлечься: телефон рядом, учитель далеко. Удерживает не строгость, а то, что ученик всё
          время что-то делает сам.
        </p>
        <ul>
          <li>
            <strong>Решение пишет ученик, а не вы.</strong> Дайте ему доску — так вы видите ход мысли, а не только
            ответ.
          </li>
          <li>
            <strong>Вопрос каждые несколько минут.</strong> Не «понятно?», а конкретный: «какой будет следующий
            шаг?».
          </li>
          <li>
            <strong>Меньше демонстрации экрана.</strong> Долгий показ чужого окна — это лекция. Разбирайте задачу на
            общей доске, где пишут оба.
          </li>
          <li>
            <strong>Короткие блоки.</strong> 10–15 минут объяснения, затем практика. На 60-минутном уроке — три-четыре
            смены деятельности.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "gruppy",
    title: "Если учеников несколько",
    body: (
      <>
        <p>В мини-группе из 3–8 человек главная проблема — все говорят одновременно или все молчат.</p>
        <ul>
          <li>Микрофоны выключены, пока говорит учитель. Слово — по поднятой руке или по имени.</li>
          <li>Рисовать на доске разрешайте одному ученику — тому, кто решает. Остальные смотрят и проверяют.</li>
          <li>Вопросы, на которые отвечают все, — в чат: так слышен каждый, а не только самый смелый.</li>
        </ul>
      </>
    ),
  },
  {
    id: "posle",
    title: "После урока",
    body: (
      <>
        <ul>
          <li>Отправьте домашнее задание сразу, пока ученик помнит, о чём шла речь.</li>
          <li>
            Если урок записывался, запись помогает ученику повторить объяснение, а вам — увидеть, где вы говорили
            слишком долго.
          </li>
          <li>Запишите себе одну вещь, которую в следующий раз сделаете иначе.</li>
        </ul>
      </>
    ),
  },
  {
    id: "gde",
    title: "Где проводить онлайн-уроки",
    body: (
      <>
        <p>Обычно репетиторы выбирают из трёх вариантов.</p>
        <ul>
          <li>
            <strong>Видеосвязь и отдельная доска</strong> — например, Zoom или Телемост плюс онлайн-доска. Привычно,
            но ученику приходят две ссылки, а учителю нужно следить за двумя окнами.
          </li>
          <li>
            <strong>Маркетплейс репетиторов со своим классом.</strong> Удобно, если оттуда же приходят ученики, но
            площадка берёт комиссию и диктует правила.
          </li>
          <li>
            <strong>Платформа для своих уроков</strong>, где видео, доска и материалы в одном окне. Ученики ваши,
            ссылка постоянная.
          </li>
        </ul>
        <p>
          Матис — из третьей группы. Ученик входит по ссылке без регистрации, доска и слайды открыты рядом с видео,
          на бесплатном тарифе можно вести уроки до трёх учеников без срока. Подробнее — на странице{" "}
          <a href="/doska" className={link}>
            онлайн-доски
          </a>{" "}
          и в{" "}
          <a href="/pricing" className={link}>
            тарифах
          </a>
          .
        </p>
      </>
    ),
  },
];

/** Счётчик Umami (vite.config.ts → seo): на стенде и локально его нет. */
declare global {
  interface Window {
    umami?: { track: (event: string) => void };
  }
}

/** Событие «Статья дочитана» — один раз, когда виден конец текста. */
function useReadToEnd() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      window.umami?.track("Статья дочитана");
      io.disconnect();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function GuidePage() {
  const end = useReadToEnd();
  return (
    <Layout page="guide">
      <article className="pb-20 pt-12 sm:pb-28 sm:pt-20">
        <div className="container-l">
          <header className="max-w-[760px]">
            <h1 className="text-h2 text-foreground">Как проводить онлайн-уроки: руководство для&nbsp;репетитора</h1>
            <p className="mt-6 max-w-[40em] text-body text-text-2 sm:text-lead">
              Техника, подготовка материалов, первый урок и группы — что проверить и как вести занятие, чтобы ученик
              был внимателен до конца.
            </p>
            <p className="mt-6 text-small text-text-3">
              Команда Матиса · <time dateTime={GUIDE_PUBLISHED}>25 ноября 2026</time>
            </p>
          </header>

          <div className="mt-14 grid gap-12 border-t border-border pt-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-20">
            <nav aria-labelledby="toc-title" className="lg:sticky lg:top-28 lg:self-start">
              <h2 id="toc-title" className="text-caption font-semibold text-text-3">
                Содержание
              </h2>
              <ol className="mt-3 space-y-1">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="-my-1 inline-block py-1.5 text-small text-text-2 transition-colors duration-150 hover:text-foreground">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="guide-prose max-w-[68ch]">
              {SECTIONS.map((s) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
                  <h2 id={`${s.id}-h`}>{s.title}</h2>
                  {s.body}
                </section>
              ))}
              <div ref={end} aria-hidden />
            </div>
          </div>
        </div>
      </article>

      <section aria-labelledby="closing-title" className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container-l flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[620px]">
            <h2 id="closing-title" className="text-h2 text-foreground">
              Проведите следующий урок в&nbsp;Матисе
            </h2>
            <p className="mt-5 text-body text-text-2">
              Бесплатный тариф без срока: до трёх учеников в уроке, доска и слайды рядом с видео.
            </p>
          </div>
          <a data-umami-event="Начать бесплатно" data-umami-event-place="статья, конец" href={APP.register} className={cn(buttonVariants({ size: "cta" }), "shrink-0 self-start lg:self-auto")}>
            Начать бесплатно
          </a>
        </div>
      </section>
    </Layout>
  );
}
