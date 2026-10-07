import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface GridLayout {
  /** Число колонок для текущего размера контейнера и количества плиток. */
  cols: number;
  rows: number;
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
  const [layout, setLayout] = useState<GridLayout>({ cols: 1, rows: 1, tileW: 0, tileH: 0, capacity: MIN_CAPACITY });
  const rafRef = useRef<number | null>(null);

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    const next = computeGrid(w, h, count, gap, aspect, minTileW, maxCapacity);
    setLayout((prev) =>
      prev.cols === next.cols &&
      prev.rows === next.rows &&
      prev.tileW === next.tileW &&
      prev.tileH === next.tileH &&
      prev.capacity === next.capacity
        ? prev
        : next,
    );
  };

  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, gap, aspect, minTileW, maxCapacity]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
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
): GridLayout {
  // В узком контейнере (телефон в альбомной ориентации) минимум — пятая часть
  // ширины, иначе на странице оставалось бы 4 плитки.
  const minW = Math.min(minTileW, w / 5);
  const minTileH = minW / aspect;
  const fitCols = minW > 0 ? Math.floor((w + gap) / (minW + gap)) : Infinity;
  const fitRows = minTileH > 0 ? Math.floor((h + gap) / (minTileH + gap)) : Infinity;
  const capacity = Math.max(MIN_CAPACITY, Math.min(maxCapacity, fitCols * fitRows));
  if (count === 0) return { cols: 1, rows: 1, tileW: 0, tileH: 0, capacity };

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

  return { cols, rows, tileW: Math.floor(tileW), tileH: Math.floor(tileH), capacity };
}
