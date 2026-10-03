import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, List, Minus, Plus } from "lucide-react";
import type {
  MaterialLayout,
  PublicMaterial,
  QuestionResponse,
  SubmitActivityResult,
  SubmitFeedbackItem,
} from "@school/shared";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { TextbookContentBlock, rowKind } from "./TextbookBlocks.js";
import { TaskMark, TextbookTask, taskState } from "./TextbookTask.js";
import { buildTextbook, hasAnswer, type TextbookPage, type TextbookStructure } from "./structure.js";
import "./textbook.css";

type Block = PublicMaterial["blocks"][number];

/** Больше стольких заданий точки не помещаются в панель — остаётся счётчик. */
const MAX_DOTS = 8;
/** С этой ширины панели страницы идут разворотом (две по ~520–600px). */
const SPREAD_MIN_WIDTH = 1100;
/** С этой ширины — круглые стрелки по бокам листа; уже — листают снизу. */
const SIDE_ARROWS_MIN_WIDTH = 700;

/** Сдача работы — есть только у ученика с настоящей попыткой. */
export interface TextbookSubmit {
  submittedAt: string | null;
  result: SubmitActivityResult | null;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}

/**
 * Учебник: новый вид материала для ученика поверх того же контента
 * (`PublicMaterial`), тех же ответов и тех же плееров заданий. Редактор,
 * схема и API не меняются.
 *
 * Материал читается страницами (`buildTextbook`): текст, иллюстрации и
 * задания идут одним потоком, задание занимает столько места, сколько ему
 * нужно. Сверху — оглавление и счёт выполненных заданий, снизу — переход к
 * следующей странице по её названию, на последней странице — сдача работы.
 *
 * Каждый ряд несёт `data-annot-block` — якорь пометок учителя; слой пометок
 * (`overlay`) рендерится внутри текущей страницы.
 */
export function TextbookView({
  material,
  responses,
  onResponseChange,
  disabled = false,
  meta,
  showHead = true,
  submit,
  overlay,
  initialBlockId = null,
  onPositionChange,
  renderAfterTask,
  barEnd,
}: {
  material: {
    title: string;
    subject: string;
    settings: { layout: MaterialLayout };
    blocks: readonly Block[];
  };
  responses: Record<string, QuestionResponse | undefined>;
  onResponseChange?: (questionId: string, response: QuestionResponse) => void;
  disabled?: boolean;
  /** Строка под заголовком: дедлайн, таймер, сохранение. */
  meta?: React.ReactNode;
  showHead?: boolean;
  submit?: TextbookSubmit;
  overlay?: React.ReactNode;
  /** Открыть на странице с этим блоком и прокрутить к нему. */
  initialBlockId?: string | null;
  /** Блок, который ученик сейчас читает (верхний видимый). */
  onPositionChange?: (blockId: string, pageIndex: number) => void;
  /** Доп. содержимое под заданием (учителю — ответ ученика и верный ответ). */
  renderAfterTask?: (blockId: string) => React.ReactNode;
  /** Доп. кнопки в конце панели навигации (на уроке — «Свернуть»). */
  barEnd?: React.ReactNode;
}) {
  const book = useMemo(
    () => buildTextbook(material.blocks, material.settings.layout),
    [material.blocks, material.settings.layout],
  );
  const byId = useMemo(() => new Map(material.blocks.map((b) => [b.id, b])), [material.blocks]);

  const [rootRef, width] = useWidth();
  const [zoom, setZoom] = useState(1);
  const [pageIndex, setPageIndex] = useState(() =>
    initialBlockId ? (book.pageOfBlock.get(initialBlockId) ?? 0) : 0,
  );
  const page = book.pages[Math.min(pageIndex, Math.max(book.pages.length - 1, 0))];

  // Число страниц изменилось (материал перечитан) — держим индекс в границах.
  useEffect(() => {
    setPageIndex((i) => Math.min(Math.max(i, 0), Math.max(book.pages.length - 1, 0)));
  }, [book.pages.length]);

  const multiPage = book.pages.length > 1;
  // Широкая панель — разворот из двух страниц, как в книге; уже — одна
  // страница со стрелками по бокам; на телефоне стрелок нет, листают снизу.
  const spread = multiPage && width >= SPREAD_MIN_WIDTH;
  const sideArrows = multiPage && width >= SIDE_ARROWS_MIN_WIDTH;
  const step = spread ? 2 : 1;
  const start = page ? (spread ? page.index - (page.index % 2) : page.index) : 0;
  const shown = book.pages.slice(start, start + step);
  const shownIds = useMemo(
    () => book.pages.slice(start, start + step).flatMap((p) => p.blockIds),
    [book, start, step],
  );

  // Куда прокрутить после смены страницы: к блоку или к началу разворота.
  const bookRef = useRef<HTMLDivElement>(null);
  const [scrollTarget, setScrollTarget] = useState<{ blockId: string | null; n: number } | null>(
    () => {
      // При открытии прокручиваем, только если ученик остановился не в начале страницы.
      if (!initialBlockId) return null;
      const p = book.pages[book.pageOfBlock.get(initialBlockId) ?? -1];
      return p && p.id !== initialBlockId ? { blockId: initialBlockId, n: 0 } : null;
    },
  );

  useEffect(() => {
    if (!scrollTarget) return;
    const root = bookRef.current;
    if (!root) return;
    const target = scrollTarget.blockId
      ? root.querySelector<HTMLElement>(`[data-annot-block="${CSS.escape(scrollTarget.blockId)}"]`)
      : null;
    const el = target ?? root;
    el.scrollIntoView({ block: "start" });
    // Фокус переносим только при явном переходе, не при открытии материала.
    if (scrollTarget.n > 0) el.focus({ preventScroll: true });
  }, [scrollTarget]);

  const goTo = useCallback((index: number, blockId: string | null = null) => {
    setPageIndex(index);
    setScrollTarget((prev) => ({ blockId, n: (prev?.n ?? 0) + 1 }));
  }, []);

  usePositionReport(bookRef, shownIds, book.pageOfBlock, onPositionChange);

  const results = useMemo(() => {
    const r = submit?.result;
    if (!r?.revealed) return null;
    return new Map<string, SubmitFeedbackItem>(r.feedback.map((f) => [f.questionId, f]));
  }, [submit?.result]);

  const totalTasks = book.taskNumber.size;
  const answered = [...book.taskNumber.keys()].filter((id) => hasAnswer(responses[id])).length;

  if (!page) {
    return (
      <div ref={rootRef} className="tb">
        <div className="tb-stage">
          {showHead ? <Head title={material.title} subject={material.subject} meta={meta} /> : null}
          <p className="py-4 text-sm text-text-2">В материале пока ничего нет.</p>
        </div>
      </div>
    );
  }

  const prev = start > 0 ? book.pages[start - 1] : undefined;
  const next = book.pages[start + step];
  const last = shown[shown.length - 1]!;
  const pageLabel = shown.length > 1 ? `${start + 1}–${start + shown.length}` : `${start + 1}`;

  // Стрелки листают страницы, пока фокус не в поле ввода и не на виджете,
  // которому стрелки нужны самому (перемотка, перестановка, ползунок).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!multiPage || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const t = e.target as HTMLElement;
    if (
      t.closest(
        "input, select, textarea, [contenteditable], [role=slider], [aria-roledescription=sortable]",
      )
    ) {
      return;
    }
    const to = e.key === "ArrowRight" ? next : prev;
    if (to) goTo(to.index);
  };

  const stateOf = (id: string) => taskState(hasAnswer(responses[id]), results?.get(id));

  const renderPage = (p: TextbookPage, side: "left" | "right" | null) => {
    const firstBlock = byId.get(p.blockIds[0] ?? "");
    const startsSection =
      multiPage && firstBlock?.type === "rich_text" && /^\s*<h[12][\s/>]/i.test(firstBlock.html ?? "");
    const isLast = p.index === book.pages.length - 1;
    return (
      <article key={p.id} className={cn("tb-sheet", side && `tb-sheet--${side}`)}>
        <div className="tb-run" aria-hidden>
          <span>{material.subject}</span>
          <span>{multiPage ? p.title : ""}</span>
        </div>

        <div className="tb-page" aria-label={p.title}>
          {startsSection ? <span className="tb-section">§ {p.index + 1}</span> : null}
          {p.blockIds.map((id) => {
            const block = byId.get(id);
            if (!block || block.type === "page_break") return null;
            const isTask = block.type === "question";
            const n = book.taskNumber.get(id) ?? 0;
            return (
              <div
                key={id}
                data-annot-block={id}
                className={cn("tb-row", rowKind(block))}
                tabIndex={isTask ? -1 : undefined}
              >
                {isTask ? <TaskMark number={n} points={block.points} state={stateOf(id)} /> : null}
                <div className="tb-main">
                  {isTask ? (
                    <>
                      <TextbookTask
                        block={block}
                        number={n}
                        value={responses[id]}
                        onChange={(r) => onResponseChange?.(id, r)}
                        disabled={disabled}
                        result={results?.get(id)}
                      />
                      {renderAfterTask?.(id)}
                    </>
                  ) : (
                    <TextbookContentBlock
                      block={block}
                      figureNumber={book.figureNumber.get(id)}
                      formulaNumber={book.formulaNumber.get(id)}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {/* Слой пометок — на каждой странице свой: штрихи, чьих блоков
              на странице нет, слой не рисует. */}
          {overlay}
        </div>

        {multiPage && !sideArrows && p === last ? (
          <nav className="tb-pager" aria-label="Страницы материала">
            {prev ? (
              <button type="button" onClick={() => goTo(prev.index)}>
                <span className="tb-pager-dir">Назад · стр. {prev.index + 1}</span>
                <span className="tb-pager-title">{prev.title}</span>
              </button>
            ) : null}
            {next ? (
              <button type="button" className="tb-pager-next" onClick={() => goTo(next.index)}>
                <span className="tb-pager-dir">Дальше · стр. {next.index + 1}</span>
                <span className="tb-pager-title">
                  {next.title}
                  <ArrowRight aria-hidden />
                </span>
              </button>
            ) : null}
          </nav>
        ) : null}

        {submit && isLast ? (
          <Finish book={book} responses={responses} submit={submit} answered={answered} onJump={goTo} />
        ) : null}

        {multiPage ? <div className="tb-folio">{p.index + 1}</div> : null}
      </article>
    );
  };

  return (
    <div ref={rootRef} className={cn("tb", spread && "tb--spread")} onKeyDown={onKeyDown}>
      <div className="tb-stage">
        {showHead ? <Head title={material.title} subject={material.subject} meta={meta} /> : null}

        <div className="tb-bar">
          {multiPage ? (
            <>
              <Contents
                book={book}
                current={shown.map((p) => p.index)}
                responses={responses}
                onPick={goTo}
              />
              {spread ? null : (
                <div className="tb-pagenav">
                  <button
                    type="button"
                    className="tb-iconbtn"
                    disabled={!prev}
                    aria-label="Предыдущая страница"
                    onClick={() => prev && goTo(prev.index)}
                  >
                    <ChevronLeft aria-hidden />
                  </button>
                  <span className="tb-pagenav-count">
                    {pageLabel} <span>из {book.pages.length}</span>
                  </span>
                  <button
                    type="button"
                    className="tb-iconbtn"
                    disabled={!next}
                    aria-label="Следующая страница"
                    onClick={() => next && goTo(next.index)}
                  >
                    <ChevronRight aria-hidden />
                  </button>
                </div>
              )}
              <span className="tb-bar-title">
                {spread ? (
                  <span className="tb-bar-pages">
                    {pageLabel} <span>из {book.pages.length}</span>
                  </span>
                ) : null}
                {page.title}
              </span>
            </>
          ) : null}
          <span className="tb-bar-grow" />
          {/* Без шапки (на уроке) дедлайн и сохранение — в панели. */}
          {!showHead && meta ? <span className="tb-bar-meta">{meta}</span> : null}
          {totalTasks > 0 ? (
            <span
              className={cn("tb-dots", totalTasks > MAX_DOTS && "tb-dots--count")}
              role="img"
              aria-label={`Отвечено ${answered} из ${totalTasks}`}
            >
              {(totalTasks > MAX_DOTS ? [] : [...book.taskNumber.keys()]).map((id) => {
                const st = stateOf(id);
                return <span key={id} className={cn("tb-dot", st !== "empty" && `tb-dot--${st}`)} />;
              })}
              <span className="tb-dots-text">
                {answered} из {totalTasks}
              </span>
            </span>
          ) : null}
          <span className="tb-bar-sep tb-bar-sep--zoom" aria-hidden />
          <div className="tb-zoom-ctl" role="group" aria-label="Размер текста">
            <button
              type="button"
              className="tb-iconbtn tb-iconbtn--muted"
              aria-label="Мельче"
              disabled={zoom <= 0.8}
              onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.1).toFixed(1)))}
            >
              <Minus aria-hidden />
            </button>
            <span className="tb-zoom-val">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="tb-iconbtn tb-iconbtn--muted"
              aria-label="Крупнее"
              disabled={zoom >= 1.3}
              onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.1).toFixed(1)))}
            >
              <Plus aria-hidden />
            </button>
          </div>
          {barEnd}
        </div>

        <div className={cn("tb-desk", sideArrows && "tb-desk--arrows")}>
          {sideArrows ? (
            <div className="tb-side tb-side--prev">
              <button
                type="button"
                className="tb-turn"
                disabled={!prev}
                aria-label="Предыдущая страница"
                onClick={() => prev && goTo(prev.index)}
              >
                <ChevronLeft aria-hidden />
              </button>
            </div>
          ) : null}

          <div
            ref={bookRef}
            className="tb-book"
            tabIndex={-1}
            aria-label={shown.map((p) => p.title).join(" · ")}
            style={zoom === 1 ? undefined : { zoom }}
          >
            {spread ? (
              <>
                {renderPage(shown[0]!, "left")}
                {shown[1] ? (
                  renderPage(shown[1], "right")
                ) : (
                  // Последняя страница нечётная — справа пустой лист, разворот не рассыпается.
                  <div className="tb-sheet tb-sheet--right tb-sheet--blank" aria-hidden />
                )}
              </>
            ) : (
              renderPage(shown[0]!, null)
            )}
          </div>

          {sideArrows ? (
            <div className="tb-side tb-side--next">
              <button
                type="button"
                className="tb-turn"
                disabled={!next}
                aria-label="Следующая страница"
                onClick={() => next && goTo(next.index)}
              >
                <ChevronRight aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Head({
  title,
  subject,
  meta,
}: {
  title: string;
  subject: string;
  meta?: React.ReactNode;
}) {
  return (
    <header className="tb-head">
      <p className="tb-kicker">{subject}</p>
      <h2 className="tb-title">{title}</h2>
      {meta ? <p className="tb-meta">{meta}</p> : null}
    </header>
  );
}

function Contents({
  book,
  current,
  responses,
  onPick,
}: {
  book: TextbookStructure;
  /** Страницы на экране (в развороте — две). */
  current: readonly number[];
  responses: Record<string, QuestionResponse | undefined>;
  onPick: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="tb-toc-trigger" aria-label="Содержание">
          <List aria-hidden />
          <span className="tb-toc-trigger-label">Содержание</span>
          <ChevronDown className="tb-chev" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[60vh] w-[min(20rem,calc(100vw-1.75rem))] overflow-y-auto rounded-2xl p-1.5">
        <nav aria-label="Содержание материала">
          <ol className="tb-toc">
            {book.pages.map((p) => {
              const done = p.taskIds.filter((id) => hasAnswer(responses[id])).length;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-current={current.includes(p.index) ? "page" : undefined}
                    onClick={() => {
                      setOpen(false);
                      onPick(p.index);
                    }}
                  >
                    <span className="tb-toc-num">{p.index + 1}</span>
                    <span>{p.title}</span>
                    {p.taskIds.length > 0 ? (
                      <span
                        className="tb-toc-tasks"
                        aria-label={`отвечено ${done} из ${p.taskIds.length}`}
                      >
                        {done}/{p.taskIds.length}
                      </span>
                    ) : (
                      <span />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </PopoverContent>
    </Popover>
  );
}

function Finish({
  book,
  responses,
  submit,
  answered,
  onJump,
}: {
  book: TextbookStructure;
  responses: Record<string, QuestionResponse | undefined>;
  submit: TextbookSubmit;
  answered: number;
  onJump: (index: number, blockId: string) => void;
}) {
  const total = book.taskNumber.size;

  if (submit.submittedAt) {
    const r = submit.result;
    return (
      <section className="tb-finish" aria-live="polite">
        <h2>Работа сдана</h2>
        <p>{formatDateTime(submit.submittedAt)}</p>
        {r && r.revealed ? (
          <p>
            Автопроверка: <b>{r.score}</b> из {r.maxScore}
            {r.feedback.some((f) => !f.autoGraded) ? ". Часть заданий проверит учитель." : "."}
          </p>
        ) : r ? (
          <p>Результаты покажет учитель.</p>
        ) : null}
      </section>
    );
  }

  const missing = [...book.taskNumber.entries()].filter(([id]) => !hasAnswer(responses[id]));

  return (
    <section className="tb-finish">
      <h2>Сдача работы</h2>
      {total > 0 ? (
        <p>
          {answered === total
            ? "Ответы есть на все задания."
            : `Ответы есть на ${answered} из ${total} ${total === 1 ? "задания" : "заданий"}.`}{" "}
          После сдачи изменить их будет нельзя.
        </p>
      ) : null}
      {missing.length > 0 ? (
        <div className="tb-finish-missing">
          <span>Без ответа:</span>
          {missing.map(([id, n]) => (
            <button
              key={id}
              type="button"
              data-n={n}
              aria-label={`К заданию ${n}`}
              onClick={() => onJump(book.pageOfBlock.get(id) ?? 0, id)}
            />
          ))}
        </div>
      ) : null}
      {submit.error ? (
        <Alert variant="destructive">
          <AlertDescription>{submit.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-1">
        <Button size="lg" onClick={submit.onSubmit} loading={submit.submitting}>
          {submit.submitting ? "Отправляем…" : "Сдать работу"}
        </Button>
      </div>
    </section>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Сообщает, какой блок ученик сейчас читает: верхний из видимых в верхней
 * половине панели. Учитель открывает материал ученика ровно на этом месте.
 */
function usePositionReport(
  pageRef: React.RefObject<HTMLDivElement | null>,
  blockIds: readonly string[],
  pageOfBlock: ReadonlyMap<string, number>,
  onPositionChange: ((blockId: string, pageIndex: number) => void) | undefined,
) {
  const cb = useRef(onPositionChange);
  cb.current = onPositionChange;
  const enabled = onPositionChange !== undefined;

  useEffect(() => {
    const root = pageRef.current;
    if (!enabled || !root || blockIds.length === 0 || typeof IntersectionObserver === "undefined") return;
    const order = new Map(blockIds.map((id, i) => [id, i]));
    const visible = new Set<string>();
    let last: string | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.annotBlock;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        let top: string | null = null;
        for (const id of visible) {
          if (top === null || (order.get(id) ?? 0) < (order.get(top) ?? 0)) top = id;
        }
        if (top && top !== last) {
          last = top;
          cb.current?.(top, pageOfBlock.get(top) ?? 0);
        }
      },
      { rootMargin: "-48px 0px -50% 0px" },
    );
    for (const el of root.querySelectorAll<HTMLElement>("[data-annot-block]")) io.observe(el);
    return () => io.disconnect();
  }, [pageRef, blockIds, pageOfBlock, enabled]);
}

/**
 * Ширина элемента: раскладка учебника зависит от панели урока, не от окна.
 * Callback-ref — корневой div у пустого и обычного учебника разный.
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(el.clientWidth);
    ro.current = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.current.observe(el);
  }, []);
  return [ref, width];
}
