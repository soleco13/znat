import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface GridLayout {
  /** Число колонок для текущего размера контейнера и количества плиток. */
  cols: number;
  rows: number;
  /** Размер контейнера, по которому считана раскладка (0 — ещё не измерен). */
  width: number;
  height: number;
  /**
   * Раскладку пересчитали из-за смены числа плиток (кто-то вошёл или вышел,
   * перелистнули страницу) — её стоит анимировать. При изменении размера окна
   * плитки встают на место сразу, как в Толке: анимация на каждый кадр
   * ресайза только тормозит.
   */
  animate: boolean;
  /** Размер плитки в px; после дотягивания до краёв пропорция может отличаться от `aspect`. */
  tileW: number;
  tileH: number;
  /**
   * Сколько плиток помещается в контейнер, не опускаясь ниже `minTileW`
   * (размер страницы сетки; от числа участников не зависит).
   */
  capacity: number;
}

interface GridOptions {
  gap?: number;
  /** Ширина/высота плитки до дотягивания. */
  aspect?: number;
  /** Минимальная ширина плитки для расчёта ёмкости страницы. */
  minTileW?: number;
  /** Потолок ёмкости страницы. */
  maxCapacity?: number;
}

/** Длительность перестройки сетки (`--motion-layout` в index.css). */
export const GRID_MOTION_MS = 300;

/** Меньше 4 плиток на странице не бывает: иначе пагинация при любом классе. */
const MIN_CAPACITY = 4;
/**
 * Дотягиваем плитки до края, если сетка уже заняла больше этой доли стороны
 * (как в Толке, §4.4 разбора), но пропорцию держим в этих пределах — дальше
 * видео в `cover` режется слишком сильно.
 */
const STRETCH_FROM = 0.75;
const MIN_STRETCHED_ASPECT = 4 / 3;
const MAX_STRETCHED_ASPECT = 2;

/**
 * Раскладка плиток участников. Перебираем число колонок и берём то, при
 * котором плитка `aspect` крупнее всего (тот же выбор, что у Толка: при
 * равных размерах контейнера колонки совпадают, см.
 * `test-results/matis-camera-grid-2026-10-07/comparison-and-design.md`).
 * Затем плитки дотягиваются до краёв, если остаток мал.
 *
 * Ёмкость страницы считается от контейнера: сколько полных плиток шириной
 * `minTileW` помещается по ширине и высоте. Пересчёт — на ResizeObserver
 * контейнера и при изменении `count`.
 */
export function useAdaptiveGrid(
  ref: React.RefObject<HTMLElement | null>,
  count: number,
  { gap = 8, aspect = 1, minTileW = 0, maxCapacity = Infinity }: GridOptions = {},
): GridLayout {
  const [layout, setLayout] = useState<GridLayout>({
    cols: 1,
    rows: 1,
    width: 0,
    height: 0,
    animate: false,
    tileW: 0,
    tileH: 0,
    capacity: MIN_CAPACITY,
  });
  const rafRef = useRef<number | null>(null);
  // Пересчёт по размеру сразу после анимированного (появилась строка страниц)
  // не должен обрывать уже идущий переход — держим анимацию до его конца.
  const animatedAt = useRef(0);

  const measure = (byCount: boolean) => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    const now = performance.now();
    if (byCount) animatedAt.current = now;
    const animate = byCount || now - animatedAt.current < GRID_MOTION_MS;
    const next = { ...computeGrid(w, h, count, gap, aspect, minTileW, maxCapacity), animate };
    setLayout((prev) =>
      prev.cols === next.cols &&
      prev.rows === next.rows &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.tileW === next.tileW &&
      prev.tileH === next.tileH &&
      prev.capacity === next.capacity
        ? prev
        : next,
    );
  };

  useLayoutEffect(() => {
    measure(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, gap, aspect, minTileW, maxCapacity]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => measure(false));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, count, gap, aspect, minTileW, maxCapacity]);

  return layout;
}

export function computeGrid(
  w: number,
  h: number,
  count: number,
  gap: number,
  aspect: number,
  minTileW: number,
  maxCapacity: number,
): Omit<GridLayout, "animate"> {
  // В узком контейнере (телефон в альбомной ориентации) минимум — пятая часть
  // ширины, иначе на странице оставалось бы 4 плитки.
  const minW = Math.min(minTileW, w / 5);
  const minTileH = minW / aspect;
  const fitCols = minW > 0 ? Math.floor((w + gap) / (minW + gap)) : Infinity;
  const fitRows = minTileH > 0 ? Math.floor((h + gap) / (minTileH + gap)) : Infinity;
  const capacity = Math.max(MIN_CAPACITY, Math.min(maxCapacity, fitCols * fitRows));
  if (count === 0) return { cols: 1, rows: 1, width: w, height: h, tileW: 0, tileH: 0, capacity };

  let cols = 1;
  let tileW = 0;
  for (let c = 1; c <= count; c += 1) {
    const r = Math.ceil(count / c);
    const t = Math.min((w - gap * (c - 1)) / c, ((h - gap * (r - 1)) / r) * aspect);
    if (t > tileW) {
      cols = c;
      tileW = t;
    }
  }
  const rows = Math.ceil(count / cols);
  let tileH = tileW / aspect;

  const totalW = cols * tileW + gap * (cols - 1);
  const totalH = rows * tileH + gap * (rows - 1);
  if (totalW / w > STRETCH_FROM && totalW < w) tileW = (w - gap * (cols - 1)) / cols;
  if (totalH / h > STRETCH_FROM && totalH < h) tileH = (h - gap * (rows - 1)) / rows;
  tileW = Math.min(tileW, tileH * MAX_STRETCHED_ASPECT);
  tileH = Math.min(tileH, tileW / MIN_STRETCHED_ASPECT);

  return { cols, rows, width: w, height: h, tileW: Math.floor(tileW), tileH: Math.floor(tileH), capacity };
}

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Где стоит каждая из `count` плиток. Плитки делятся по рядам поровну (трое —
 * два сверху и один снизу, семеро в два ряда — 4 и 3), каждый ряд и вся сетка
 * по центру контейнера — как у Толка. Раньше неполный ряд прижимался влево,
 * и трое выглядели «буквой Г» (жалоба 2026-10-24).
 */
export function tileRects(layout: Pick<GridLayout, "rows" | "width" | "height" | "tileW" | "tileH">, count: number, gap: number): TileRect[] {
  const { rows, width, height, tileW, tileH } = layout;
  if (count === 0 || tileW <= 0 || tileH <= 0) return [];
  const base = Math.floor(count / rows);
  const extra = count % rows;
  const gridH = rows * tileH + gap * (rows - 1);
  const top = Math.max(0, (height - gridH) / 2);
  const rects: TileRect[] = [];
  for (let r = 0; r < rows; r += 1) {
    // Лишние плитки — в верхние ряды: неполный ряд внизу, как у Толка.
    const inRow = base + (r < extra ? 1 : 0);
    const rowW = inRow * tileW + gap * (inRow - 1);
    const left = Math.max(0, (width - rowW) / 2);
    for (let c = 0; c < inRow; c += 1) {
      rects.push({ x: Math.round(left + c * (tileW + gap)), y: Math.round(top + r * (tileH + gap)), w: tileW, h: tileH });
    }
  }
  return rects;
}
