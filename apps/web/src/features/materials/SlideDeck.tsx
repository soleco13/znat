import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { paginateMaterial, slideIndexForBlock } from "@school/shared";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";

/**
 * Материал слайдами (доп. Э13). Разбивку считает чистая `paginateMaterial`
 * (`@school/shared`) — тот же результат у плеера ученика, превью редактора и
 * вида учителя на уроке. Сам компонент только листает и рендерит один слайд.
 *
 * Слой пометок учителя (`MaterialAnnotationLayer`) прокидывается как
 * `overlay` — он рендерится ВНУТРИ `relative`-бокса текущего слайда, поэтому
 * позиционируется ровно по нему, а не по всей колонке; кнопки листания
 * остаются вне бокса и слоем не перекрываются.
 */
export interface SlideDeckBlock {
  type: string;
  id: string;
  html?: string;
}

export function SlideDeck<T extends SlideDeckBlock>({
  blocks,
  groups,
  renderBlock,
  header,
  footer,
  overlay,
  initialBlockId = null,
  onSlideChange,
  slideClassName,
}: {
  blocks: readonly T[];
  /** Группы-конструкции — не рвутся между слайдами (у `PublicMaterial` их нет). */
  groups?: readonly { blockIds: readonly string[] }[];
  renderBlock: (block: T) => React.ReactNode;
  header?: React.ReactNode;
  /** Показывается только на последнем слайде (кнопка «Сдать работу»). */
  footer?: React.ReactNode;
  /** Слой поверх содержимого слайда (пометки учителя). */
  overlay?: React.ReactNode;
  /** Открыть на слайде с этим блоком (учитель — на месте ученика). */
  initialBlockId?: string | null;
  onSlideChange?: (firstBlockId: string, index: number) => void;
  slideClassName?: string;
}) {
  const slides = useMemo(
    () => paginateMaterial({ blocks: blocks as readonly SlideDeckBlock[], groups }),
    [blocks, groups],
  );
  const byId = useMemo(() => {
    const m = new Map<string, T>();
    for (const b of blocks) m.set(b.id, b);
    return m;
  }, [blocks]);

  const [index, setIndex] = useState(() => slideIndexForBlock(slides, initialBlockId));

  // Смена ученика / перенарезка материала — снова навести на нужный слайд.
  const seenInitial = useRef(initialBlockId);
  useEffect(() => {
    if (seenInitial.current !== initialBlockId) {
      seenInitial.current = initialBlockId;
      setIndex(slideIndexForBlock(slides, initialBlockId));
    }
  }, [initialBlockId, slides]);

  // Держим индекс в границах, если число слайдов изменилось.
  useEffect(() => {
    setIndex((i) => Math.min(Math.max(i, 0), Math.max(slides.length - 1, 0)));
  }, [slides.length]);

  const total = slides.length;
  const current = slides[Math.min(index, Math.max(total - 1, 0))];

  useEffect(() => {
    if (current) onSlideChange?.(current.id, index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, index]);

  const go = useCallback(
    (delta: number) =>
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (total === 0 || !current) {
    return <p className="text-sm text-muted-foreground">Материал пуст</p>;
  }

  const isLast = index >= total - 1;

  return (
    <div className="flex flex-col gap-3">
      {header}

      <div className="flex flex-wrap items-center gap-1" aria-hidden>
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setIndex(i)}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-6 bg-primary" : "w-3 bg-border hover:bg-muted-foreground/40",
            )}
            aria-label={`Слайд ${i + 1}`}
          />
        ))}
      </div>

      <div className={cn("relative", slideClassName)}>
        <div className="flex flex-col gap-4">
          {current.blockIds.map((id) => {
            const block = byId.get(id);
            return block ? <div key={id}>{renderBlock(block)}</div> : null;
          })}
        </div>
        {overlay}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(-1)}
          disabled={index === 0}
        >
          <ChevronLeft aria-hidden />
          Назад
        </Button>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          Слайд {index + 1} из {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(1)}
          disabled={isLast}
        >
          Дальше
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {isLast && footer ? <div>{footer}</div> : null}
    </div>
  );
}
