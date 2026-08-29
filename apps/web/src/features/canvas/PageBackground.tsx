import { useEffect, useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Э3.7, §3.3 ТЗ: "шаблон (клетка, линейка, координатная плоскость, нотный
 * стан)". Э4.6 добавляет `"image"` — фон-страница это отрендеренный слайд
 * импортированной презентации (`PageBackground` получает его в пропе `slide`).
 */
export type BackgroundKind = "blank" | "grid" | "lined" | "coordinate" | "staff" | "image";

/** Фон импортированного слайда (Э4.6). Хранится в `PageMeta.slide` (Board.tsx). */
export type SlidePageRef = {
  deckId: string;
  index: number;
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
};

/** Только выбираемые учителем вручную шаблоны — `"image"` ставится импортом слайдов, не из селектора. */
export const BACKGROUND_KIND_LABELS: Record<Exclude<BackgroundKind, "image">, string> = {
  blank: "Пусто",
  grid: "Клетка",
  lined: "Линейка",
  coordinate: "Координатная плоскость",
  staff: "Нотный стан",
};

/** Шаг клетки/линейки в мировых координатах Excalidraw (px при zoom = 1). */
const CELL = 32;
const STAFF_PERIOD = 160;
const STAFF_LINE_GAP = 13;

/**
 * Ширина слайда в мировых координатах холста (Э4.6). Слайд «приколот» к
 * мировому прямоугольнику от (0, 0) — одинаковому у всех участников, поэтому
 * рисование поверх слайда синхронизируется теми же координатами, что и
 * элементы страницы. Высота — из пропорций конкретного слайда.
 */
const SLIDE_WORLD_WIDTH = 1000;

const GRID_IMAGE =
  "linear-gradient(to right, #d8dde3 1px, transparent 1px)," +
  "linear-gradient(to bottom, #d8dde3 1px, transparent 1px)";
const LINED_IMAGE = "linear-gradient(to bottom, #c7d2e0 1px, transparent 1px)";

function staffImage(): string {
  const stops: string[] = [];
  for (let i = 0; i < 5; i++) {
    const y = i * STAFF_LINE_GAP;
    stops.push(`transparent ${y}px`, `#333 ${y}px`, `#333 ${y + 1}px`, `transparent ${y + 1}px`);
  }
  return `repeating-linear-gradient(to bottom, ${stops.join(", ")}, transparent ${STAFF_PERIOD}px)`;
}

function patternFor(kind: BackgroundKind): { backgroundImage?: string; sizeWorld: [number, number] } {
  switch (kind) {
    case "grid":
      return { backgroundImage: GRID_IMAGE, sizeWorld: [CELL, CELL] };
    case "lined":
      return { backgroundImage: LINED_IMAGE, sizeWorld: [CELL, CELL] };
    case "coordinate":
      return { backgroundImage: GRID_IMAGE, sizeWorld: [CELL, CELL] };
    case "staff":
      return { backgroundImage: staffImage(), sizeWorld: [CELL, STAFF_PERIOD] };
    case "image":
    case "blank":
    default:
      return { sizeWorld: [CELL, CELL] };
  }
}

/**
 * Слой фона страницы (Э3.7, §3.3/§4.3 ТЗ: "Фон под элементами, не
 * выделяется"). Сознательно НЕ элемент Excalidraw (даже залоченный
 * элемент технически остаётся выделяемым/снимаемым с замка через штатный
 * UI Excalidraw — "правый клик → открепить"), а обычный DOM-слой ПОД
 * канвасом. У `Board.tsx` канвас прозрачный (`viewBackgroundColor:
 * "transparent"`), чтобы этот слой было видно. При таком подходе у фона в
 * принципе нет пути выделения/перемещения/удаления через интерфейс
 * Excalidraw — не потому что что-то запрещено, а потому что это просто не
 * элемент сцены.
 *
 * Паттерн/слайд обязан панорамироваться/масштабироваться СИНХРОННО с
 * холстом Excalidraw, иначе на глаз "плывёт" при скролле. Формула ниже —
 * точное совпадение с внутренним преобразованием координат самого
 * Excalidraw (`sceneCoordsToViewportCoords()` в бандле пакета):
 * `screenX = (sceneX + scrollX) * zoom + offsetLeft`. `offsetLeft`/`offsetTop`
 * опущены — слой позиционируется как sibling канваса с тем же bounding box.
 */
export function PageBackground({
  api,
  kind,
  slide,
}: {
  api: ExcalidrawImperativeAPI | null;
  kind: BackgroundKind;
  slide?: SlidePageRef | null;
}) {
  const patternRef = useRef<HTMLDivElement>(null);
  const axisXRef = useRef<HTMLDivElement>(null);
  const axisYRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLImageElement>(null);

  const slideAspect = slide && slide.width > 0 ? slide.height / slide.width : 0.75;

  useEffect(() => {
    if (!api) return;

    const { sizeWorld } = patternFor(kind);
    const slideWorldW = SLIDE_WORLD_WIDTH;
    const slideWorldH = SLIDE_WORLD_WIDTH * slideAspect;

    const applyTransform = (scrollX: number, scrollY: number, zoomValue: number) => {
      if (patternRef.current) {
        patternRef.current.style.backgroundSize = `${sizeWorld[0] * zoomValue}px ${sizeWorld[1] * zoomValue}px`;
        patternRef.current.style.backgroundPosition = `${scrollX * zoomValue}px ${scrollY * zoomValue}px`;
      }
      // Оси координатной плоскости — не повторяющийся паттерн, а линии
      // через мировую точку (0, 0), позиционируются напрямую.
      if (axisYRef.current) axisYRef.current.style.top = `${scrollY * zoomValue}px`;
      if (axisXRef.current) axisXRef.current.style.left = `${scrollX * zoomValue}px`;
      // Слайд (Э4.6) — мировой прямоугольник от (0, 0), та же формула.
      if (slideRef.current) {
        slideRef.current.style.left = `${scrollX * zoomValue}px`;
        slideRef.current.style.top = `${scrollY * zoomValue}px`;
        slideRef.current.style.width = `${slideWorldW * zoomValue}px`;
        slideRef.current.style.height = `${slideWorldH * zoomValue}px`;
      }
    };

    const state = api.getAppState();
    applyTransform(state.scrollX, state.scrollY, state.zoom.value);

    return api.onScrollChange((scrollX, scrollY, zoom) => applyTransform(scrollX, scrollY, zoom.value));
  }, [api, kind, slideAspect]);

  const { backgroundImage } = patternFor(kind);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div ref={patternRef} style={{ position: "absolute", inset: 0, backgroundImage }} />
      {kind === "image" && slide && (
        <img
          ref={slideRef}
          src={slide.imageUrl}
          alt=""
          draggable={false}
          style={{ position: "absolute", left: 0, top: 0, background: "#fff", boxShadow: "0 0 0 1px #d8dde3" }}
        />
      )}
      {kind === "coordinate" && (
        <>
          <div ref={axisYRef} style={{ position: "absolute", left: 0, right: 0, height: 2, background: "#8892a0" }} />
          <div ref={axisXRef} style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: "#8892a0" }} />
        </>
      )}
    </div>
  );
}
