import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
import { TextbookContentBlock, marginFor, rowKind } from "./TextbookBlocks.js";
import { TaskMargin, TextbookTask } from "./TextbookTask.js";
import { buildTextbook, hasAnswer, type TextbookStructure } from "./structure.js";
import "./textbook.css";

type Block = PublicMaterial["blocks"][number];

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
}) {
  const book = useMemo(
    () => buildTextbook(material.blocks, material.settings.layout),
    [material.blocks, material.settings.layout],
  );
  const byId = useMemo(() => new Map(material.blocks.map((b) => [b.id, b])), [material.blocks]);

  const [pageIndex, setPageIndex] = useState(() =>
    initialBlockId ? (book.pageOfBlock.get(initialBlockId) ?? 0) : 0,
  );
  const page = book.pages[Math.min(pageIndex, Math.max(book.pages.length - 1, 0))];

  // Число страниц изменилось (материал перечитан) — держим индекс в границах.
  useEffect(() => {
    setPageIndex((i) => Math.min(Math.max(i, 0), Math.max(book.pages.length - 1, 0)));
  }, [book.pages.length]);

  // Куда прокрутить после смены страницы: к блоку или к началу страницы.
  const pageRef = useRef<HTMLDivElement>(null);
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
    const root = pageRef.current;
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

  usePositionReport(pageRef, page?.blockIds, page?.index ?? 0, onPositionChange);

  const results = useMemo(() => {
    const r = submit?.result;
    if (!r?.revealed) return null;
    return new Map<string, SubmitFeedbackItem>(r.feedback.map((f) => [f.questionId, f]));
  }, [submit?.result]);

  const totalTasks = book.taskNumber.size;
  const answered = [...book.taskNumber.keys()].filter((id) => hasAnswer(responses[id])).length;

  if (!page) {
    return (
      <div className="tb">
        {showHead ? <Head title={material.title} subject={material.subject} meta={meta} /> : null}
        <p className="text-sm text-text-2">В материале пока ничего нет.</p>
      </div>
    );
  }

  const prev = book.pages[page.index - 1];
  const next = book.pages[page.index + 1];
  const multiPage = book.pages.length > 1;

  return (
    <div className="tb">
      {showHead ? <Head title={material.title} subject={material.subject} meta={meta} /> : null}

      {multiPage || totalTasks > 0 ? (
        <div className="tb-bar">
          {multiPage ? (
            <>
              <Contents book={book} current={page.index} responses={responses} onPick={goTo} />
              <span className="tb-bar-count">
                стр. {page.index + 1} из {book.pages.length}
              </span>
            </>
          ) : null}
          {totalTasks > 0 ? (
            <span className="tb-bar-tasks">
              Отвечено <b>{answered}</b> из {totalTasks}
            </span>
          ) : null}
        </div>
      ) : null}

      <div ref={pageRef} className="tb-page" tabIndex={-1} aria-label={page.title}>
        {page.blockIds.map((id) => {
          const block = byId.get(id);
          if (!block || block.type === "page_break") return null;
          const isTask = block.type === "question";
          return (
            <div
              key={id}
              data-annot-block={id}
              className={cn("tb-row", rowKind(block))}
              tabIndex={isTask ? -1 : undefined}
            >
              <div className="tb-margin">
                {isTask ? (
                  <TaskMargin number={book.taskNumber.get(id) ?? 0} points={block.points} />
                ) : (
                  marginFor(block)
                )}
              </div>
              <div className="tb-main">
                {isTask ? (
                  <>
                    <TextbookTask
                      block={block}
                      number={book.taskNumber.get(id) ?? 0}
                      value={responses[id]}
                      onChange={(r) => onResponseChange?.(id, r)}
                      disabled={disabled}
                      result={results?.get(id)}
                    />
                    {renderAfterTask?.(id)}
                  </>
                ) : (
                  <TextbookContentBlock block={block} figureNumber={book.figureNumber.get(id)} />
                )}
              </div>
            </div>
          );
        })}
        {overlay}
      </div>

      {multiPage ? (
        <nav className="tb-pager" aria-label="Страницы материала">
          {prev ? (
            <button type="button" onClick={() => goTo(prev.index)}>
              <span className="tb-pager-dir">Назад</span>
              <span className="tb-pager-title">{prev.title}</span>
            </button>
          ) : null}
          {next ? (
            <button type="button" className="tb-pager-next" onClick={() => goTo(next.index)}>
              <span className="tb-pager-dir">Дальше</span>
              <span className="tb-pager-title">{next.title}</span>
            </button>
          ) : null}
        </nav>
      ) : null}

      {submit && !next ? (
        <Finish book={book} responses={responses} submit={submit} answered={answered} onJump={goTo} />
      ) : null}
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
      <h2 className="tb-title">{title}</h2>
      <p className="tb-meta">
        {subject}
        {meta ? <> · {meta}</> : null}
      </p>
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
  current: number;
  responses: Record<string, QuestionResponse | undefined>;
  onPick: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="tb-toc-trigger">
          Содержание
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[60vh] w-[min(22rem,90vw)] overflow-y-auto p-1.5">
        <nav aria-label="Содержание материала">
          <ol className="tb-toc">
            {book.pages.map((p) => {
              const done = p.taskIds.filter((id) => hasAnswer(responses[id])).length;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-current={p.index === current ? "page" : undefined}
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
        <div className="mt-1">
          <p className="text-[14px] text-text-2">Без ответа:</p>
          <div className="tb-finish-missing">
            {missing.map(([id, n]) => (
              <button key={id} type="button" onClick={() => onJump(book.pageOfBlock.get(id) ?? 0, id)}>
                задание {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {submit.error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{submit.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button size="lg" className="mt-4" onClick={submit.onSubmit} loading={submit.submitting}>
        {submit.submitting ? "Отправляем…" : "Сдать работу"}
      </Button>
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
  blockIds: readonly string[] | undefined,
  pageIndex: number,
  onPositionChange: ((blockId: string, pageIndex: number) => void) | undefined,
) {
  const cb = useRef(onPositionChange);
  cb.current = onPositionChange;
  const enabled = onPositionChange !== undefined;

  useEffect(() => {
    const root = pageRef.current;
    if (!enabled || !root || !blockIds || typeof IntersectionObserver === "undefined") return;
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
          cb.current?.(top, pageIndex);
        }
      },
      { rootMargin: "-48px 0px -50% 0px" },
    );
    for (const el of root.querySelectorAll<HTMLElement>("[data-annot-block]")) io.observe(el);
    return () => io.disconnect();
  }, [pageRef, blockIds, pageIndex, enabled]);
}
