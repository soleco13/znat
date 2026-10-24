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
  /** Размер плитки в px: вся клетка (от 1:1 до 16:9) или `aspect`, вписанная в клетку (`tileInCell`). */
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
  /** Базовые пропорции плитки (ширина/высота), когда клетка слишком узкая или широкая. */
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
 * Раскладка плиток участников, как у Контур Толка (замеры 2026-10-24): перебираем
 * число колонок и берём то, при котором плитка крупнее всего; форма плитки —
 * `tileInCell` (клетка целиком или 4:3).
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
  let tileH = 0;
  let empty = Infinity;
  for (let c = 1; c <= count; c += 1) {
    const r = Math.ceil(count / c);
    const [tw, th] = tileInCell((w - gap * (c - 1)) / c, (h - gap * (r - 1)) / r, aspect);
    const area = tw * th;
    const best = tileW * tileH;
    // Разница в площади до 1 % не в счёт — тогда где меньше пустых мест (трое
    // в высоком окне — столбиком, а не 2 + 1, как у Толка).
    if (area > best * 1.01 || (area >= best * 0.99 && c * r - count < empty)) {
      cols = c;
      tileW = tw;
      tileH = th;
      empty = c * r - count;
    }
  }
  const rows = Math.ceil(count / cols);

  return { cols, rows, width: w, height: h, tileW: Math.floor(tileW), tileH: Math.floor(tileH), capacity };
}

/** Клетка такой формы заполняется плиткой целиком; иначе плитка — `aspect` по центру. */
export const FILL_MIN_ASPECT = 1;
export const FILL_MAX_ASPECT = 16 / 9;

/**
 * Плитка в клетке `cellW × cellH` по правилу Контур Толка (замеры 2026-10-24,
 * test-results/kontur-research-2026-10-14/data/kontur-tiles): если клетка от
 * квадрата до 16:9 — плитка занимает её всю (видео обрезается по краям), иначе
 * плитка базовых пропорций `aspect` (4:3), вписанная в клетку. Так плитка не
 * становится ни колонной, ни полосой, но и не оставляет пустых полей, когда
 * окно почти подходит.
 */
export function tileInCell(cellW: number, cellH: number, aspect: number): [number, number] {
  if (cellW <= 0 || cellH <= 0) return [0, 0];
  const a = cellW / cellH;
  if (a >= FILL_MIN_ASPECT - 1e-3 && a <= FILL_MAX_ASPECT + 1e-3) return [cellW, cellH];
  const w = Math.min(cellW, cellH * aspect);
  return [w, w / aspect];
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
