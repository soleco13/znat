import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Pencil, Highlighter, RotateCcw, Trash2, X } from "lucide-react";
import { ANNOTATION_COLORS, type AnnotationColor, type AnnotationStroke, type AnnotationTool } from "@school/shared";

import { cn } from "@/lib/utils";
import { SimpleTooltip } from "@/shared/ui/tooltip";

const EMPTY_TOPS: Map<string, number> = new Map();

/**
 * Э13 — слой пометок учителя ПОВЕРХ материала ученика. Прозрачный SVG на всю
 * колонку материала; координаты штрихов — в пикселях контента на момент
 * рисования (`stroke.w` = ширина колонки тогда), при отрисовке масштабируются
 * на `текущая ширина / w`.
 *
 *  - `editable` (учитель, режим «Разметка»): SVG ловит указатель, снизу —
 *    плавающая панель инструментов; каждый завершённый штрих → `onChange`.
 *  - иначе (ученик, всегда; учитель в режиме просмотра): `pointer-events:
 *    none` — клики проходят к полям ответов под слоем, штрихи только видны.
 *
 * Родитель ОБЯЗАН быть `position: relative` и содержать сам материал —
 * слой позиционируется `absolute inset-0` внутри него.
 */
export function MaterialAnnotationLayer({
  strokes,
  editable,
  onChange,
  onExit,
}: {
  strokes: AnnotationStroke[];
  editable: boolean;
  onChange?: (next: AnnotationStroke[]) => void;
  /** Кнопка «Готово» на панели — выход из режима разметки (только `editable`). */
  onExit?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<AnnotationColor>(ANNOTATION_COLORS[0]);
  const [erasing, setErasing] = useState(false);
  // Текущий незавершённый штрих — в state, чтобы рисовать его вживую.
  const [draft, setDraft] = useState<number[] | null>(null);
  const draftRef = useRef<number[] | null>(null);

  // Размер слоя = размер родителя (колонки материала). ResizeObserver — та же
  // высота у всех, независимо от локального рендера.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const sync = () => setSize({ w: el.clientWidth, h: el.scrollHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // Материал меняет высоту и от ответов ученика, не только от ресайза окна.
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const pointAt = useCallback((e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  }, []);

  /** Текущие верхи блоков материала (`data-annot-block`) в координатах слоя. */
  const blockTops = useCallback((): Map<string, number> => {
    const parent = svgRef.current?.parentElement;
    const map = new Map<string, number>();
    if (!parent) return map;
    const base = parent.getBoundingClientRect().top;
    for (const el of parent.querySelectorAll<HTMLElement>("[data-annot-block]")) {
      const id = el.dataset.annotBlock;
      if (id) map.set(id, el.getBoundingClientRect().top - base);
    }
    return map;
  }, []);

  /** Блок-якорь для точки `y` (в текущих px слоя): тот, в чей вертикальный диапазон она попала, иначе ближайший сверху. */
  const anchorFor = useCallback(
    (y: number): { id: string; top: number } => {
      const parent = svgRef.current?.parentElement;
      if (!parent) return { id: "", top: 0 };
      const base = parent.getBoundingClientRect().top;
      const els = [...parent.querySelectorAll<HTMLElement>("[data-annot-block]")];
      let best: { id: string; top: number } | null = null;
      for (const el of els) {
        const id = el.dataset.annotBlock;
        if (!id) continue;
        const r = el.getBoundingClientRect();
        const top = r.top - base;
        const bottom = r.bottom - base;
        if (y >= top && y <= bottom) return { id, top };
        if (y > bottom && (!best || top > best.top)) best = { id, top };
      }
      return best ?? { id: "", top: 0 };
    },
    [],
  );

  /**
   * Абсолютный Y точки штриха в текущих px слоя: верх блока-якоря (уже в
   * текущих px) + смещение внутри блока, масштабированное как всё содержимое.
   */
  const absY = (s: AnnotationStroke, yRel: number, k: number, tops: Map<string, number>): number => {
    const anchorTop = s.anchor ? (tops.get(s.anchor) ?? 0) : 0;
    return anchorTop + yRel * k;
  };

  const eraseAt = useCallback(
    (x: number, y: number) => {
      if (!onChange || size.w === 0) return;
      const R = 14; // радиус ластика в текущих px
      const tops = blockTops();
      const kept = strokes.filter((s) => {
        // Штрих не на текущем слайде (его блок-якорь не в DOM) — не стираем.
        if (s.anchor && !tops.has(s.anchor)) return true;
        const k = size.w / s.w;
        for (let i = 0; i < s.pts.length; i += 2) {
          const dx = s.pts[i]! * k - x;
          const dy = absY(s, s.pts[i + 1]!, k, tops) - y;
          if (dx * dx + dy * dy <= R * R) return false;
        }
        return true;
      });
      if (kept.length !== strokes.length) onChange(kept);
    },
    [strokes, size.w, onChange, blockTops],
  );

  /**
   * «Стереть» — только пометки на ТЕКУЩЕМ слайде (у прокрутки виден весь
   * материал, значит стирает всё, как раньше). Штрихи других слайдов
   * (их блок-якорь не в DOM) сохраняются.
   */
  const clearVisible = useCallback(() => {
    if (!onChange) return;
    const tops = blockTops();
    onChange(strokes.filter((s) => s.anchor !== "" && !tops.has(s.anchor)));
  }, [onChange, strokes, blockTops]);

  function onPointerDown(e: React.PointerEvent) {
    if (!editable) return;
    e.preventDefault();
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* синтетический указатель без активного захвата (тесты) — не критично */
    }
    const [x, y] = pointAt(e);
    if (erasing) {
      eraseAt(x, y);
      return;
    }
    draftRef.current = [x, y];
    setDraft([x, y]);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!editable) return;
    const [x, y] = pointAt(e);
    if (erasing) {
      if (e.buttons === 1) eraseAt(x, y);
      return;
    }
    const cur = draftRef.current;
    if (!cur) return;
    const lastX = cur[cur.length - 2]!;
    const lastY = cur[cur.length - 1]!;
    if ((x - lastX) ** 2 + (y - lastY) ** 2 < 4) return; // прореживание ~2px
    cur.push(x, y);
    setDraft([...cur]);
  }

  function commitDraft() {
    const cur = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!cur || cur.length < 4 || !onChange || size.w === 0) return;
    // Якорь — блок под ПЕРВОЙ точкой штриха; Y всех точек храним от его верха.
    const { id: anchor, top: anchorTop } = anchorFor(cur[1]!);
    const pts: number[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      pts.push(Math.round(cur[i]! * 100) / 100, Math.round((cur[i + 1]! - anchorTop) * 100) / 100);
    }
    const stroke: AnnotationStroke = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      tool,
      color,
      size: tool === "marker" ? 16 : 3,
      w: size.w,
      anchor,
      pts,
    };
    onChange([...strokes, stroke]);
  }

  const renderStroke = (s: AnnotationStroke, key: string, live = false) => {
    const k = live ? 1 : size.w > 0 ? size.w / s.w : 1;
    const tops = live ? EMPTY_TOPS : blockTops();
    // Материал слайдами: штрих, чей блок-якорь не на текущем слайде, не рисуем
    // (иначе `absY` посадил бы его в начало колонки).
    if (!live && s.anchor && !tops.has(s.anchor)) return null;
    const pts: string[] = [];
    for (let i = 0; i < s.pts.length; i += 2) {
      const x = s.pts[i]! * k;
      const y = live ? s.pts[i + 1]! : absY(s, s.pts[i + 1]!, k, tops);
      pts.push(`${x},${y}`);
    }
    return (
      <polyline
        key={key}
        points={pts.join(" ")}
        fill="none"
        stroke={s.color}
        strokeWidth={s.size * k}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={s.tool === "marker" ? 0.4 : 1}
      />
    );
  };

  return (
    <>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className={cn("absolute inset-0", editable ? "cursor-crosshair" : "pointer-events-none")}
        style={{ touchAction: editable ? "none" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={commitDraft}
        onPointerCancel={commitDraft}
      >
        {strokes.map((s) => renderStroke(s, s.id))}
        {draft && draft.length >= 4
          ? renderStroke(
              { id: "draft", tool, color, size: tool === "marker" ? 16 : 3, w: size.w, anchor: "", pts: draft },
              "draft",
              true,
            )
          : null}
      </svg>

      {editable ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur">
            <ToolButton label="Карандаш" active={tool === "pen" && !erasing} onClick={() => { setTool("pen"); setErasing(false); }}>
              <Pencil className="size-4" aria-hidden />
            </ToolButton>
            <ToolButton label="Маркер" active={tool === "marker" && !erasing} onClick={() => { setTool("marker"); setErasing(false); }}>
              <Highlighter className="size-4" aria-hidden />
            </ToolButton>
            <ToolButton label="Ластик" active={erasing} onClick={() => setErasing((v) => !v)}>
              <Eraser className="size-4" aria-hidden />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-border" />
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Цвет ${c}`}
                onClick={() => { setColor(c); setErasing(false); }}
                className={cn(
                  "size-6 rounded-full border-2 transition-transform",
                  color === c && !erasing ? "scale-110 border-foreground" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton
              label="Отменить последний штрих"
              disabled={strokes.length === 0}
              onClick={() => onChange?.(strokes.slice(0, -1))}
            >
              <RotateCcw className="size-4" aria-hidden />
            </ToolButton>
            <ToolButton
              label="Стереть пометки на слайде"
              disabled={strokes.length === 0}
              onClick={clearVisible}
            >
              <Trash2 className="size-4" aria-hidden />
            </ToolButton>
            {onExit ? (
              <>
                <span className="mx-1 h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={onExit}
                  className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                  Готово
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <SimpleTooltip content={label} side="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors disabled:opacity-40",
          active ? "bg-primary-light text-primary" : "text-muted-foreground hover:bg-secondary",
        )}
      >
        {children}
      </button>
    </SimpleTooltip>
  );
}
