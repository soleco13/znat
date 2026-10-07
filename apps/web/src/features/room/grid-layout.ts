/**
 * Раскладка плиток участников — чистые функции без React и DOM.
 *
 * `RoomVideoGrid` отдаёт сюда упорядоченный список участников, размер своего
 * контейнера и режим, а получает слоты: где и какого размера каждая плитка.
 * Плитки рендерятся одним списком в одном контейнере с абсолютным
 * позиционированием, поэтому смена режима (сетка → колонка у доски → окно
 * учителя) или перестановка не пересоздают `<video>`: меняются только
 * координаты, и перемещение анимируется CSS-переходом.
 *
 * Порядок участников здесь не меняется никогда — его задаёт вызывающий
 * (персонал первым, дальше по времени входа). Говорящий в обычной сетке
 * остаётся на своём месте; отдельное место у него только в режимах
 * с крупным планом (`speaker`, `strip`).
 */

export type TileSize = "lg" | "md" | "sm" | "xs";
export type GridMode = "grid" | "speaker" | "rail" | "strip" | "pip";

export interface TileSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: TileSize;
}

export interface MoreSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Сколько участников за этой плиткой. */
  count: number;
}

export interface GridPlan {
  slots: TileSlot[];
  more: MoreSlot | null;
  /** Высота содержимого (для колонки с прокруткой). */
  contentH: number;
  /** Сетка: страниц всего, текущая (после ограничения), первый показанный по счёту. */
  pages: number;
  page: number;
  start: number;
  /** На странице помещается плиток (вместимость при текущем размере). */
  perPage: number;
}

export const GRID_GAP = 10;
const ASPECT = 16 / 9;
/** Колонка у доски/демонстрации — ширина задаётся снаружи (`w-[190px]`). */
const RAIL_GAP = 8;
/** Лента телефона: не больше стольких клеток (последняя — «+N»), плитка 3:4. */
export const STRIP_VISIBLE = 4;
const STRIP_MAX_TILE_W = 84;

/**
 * Минимальная ширина плитки и потолок числа плиток на странице. Плитка должна
 * оставаться такой, чтобы различалось лицо и читалось имя: 30 микроскопических
 * плиток хуже, чем 20 нормальных и «+10».
 */
export function gridDensity(containerW: number, containerH: number): { minTileW: number; maxTiles: number } {
  // Низкий экран (телефон в альбомной ориентации, маленькое окно).
  if (containerH < 420 || containerW < 700) return { minTileW: 150, maxTiles: 12 };
  return { minTileW: 240, maxTiles: 25 };
}

/** Лучшее число колонок для `count` плиток 16:9: максимальная площадь плитки. */
export function fitGrid(count: number, w: number, h: number, gap = GRID_GAP): { cols: number; rows: number; tileW: number; tileH: number } {
  let best = { cols: 1, rows: Math.max(1, count), tileW: 0, tileH: 0 };
  if (count <= 0 || w <= 0 || h <= 0) return best;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const tileW = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * ASPECT);
    if (tileW > best.tileW) best = { cols, rows, tileW, tileH: tileW / ASPECT };
  }
  return { ...best, tileW: Math.floor(best.tileW), tileH: Math.floor(best.tileH) };
}

/** Сколько плиток помещается на странице так, чтобы плитка была не уже `minTileW`. */
export function gridCapacity(w: number, h: number, gap = GRID_GAP): number {
  const { minTileW, maxTiles } = gridDensity(w, h);
  let cap = 1;
  for (let n = 2; n <= maxTiles; n += 1) {
    if (fitGrid(n, w, h, gap).tileW >= minTileW) cap = n;
  }
  // Даже в маленьком окне — не меньше четырёх: иначе «+N» на двух участниках.
  return Math.max(cap, Math.min(4, maxTiles));
}

function tileSizeFor(tileW: number, paged: boolean): TileSize {
  if (tileW < 200) return "sm";
  return paged || tileW < 360 ? "md" : "lg";
}

/**
 * Сетка на весь стейдж. Помещается не больше `perPage` плиток; если участников
 * больше — страницы: на каждой `perPage − 1` плиток и клетка «+N» (как раньше,
 * но вместимость теперь от размера экрана, а не фиксированные 12). Ряды
 * заполняются слева направо и прижаты влево: новый участник встаёт в конец
 * и не сдвигает остальных, пока не поменялось число колонок.
 */
export function planGrid(ids: readonly string[], w: number, h: number, page: number): GridPlan {
  const total = ids.length;
  const perPage = gridCapacity(w, h);
  const paged = total > perPage;
  const perPageTiles = paged ? perPage - 1 : total;
  const pages = paged ? Math.ceil((total - perPage) / perPageTiles) + 1 : 1;
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const start = paged ? safePage * perPageTiles : 0;
  const isLast = !paged || total - start <= perPage;
  const shown = paged ? ids.slice(start, isLast ? undefined : start + perPageTiles) : ids;
  const moreCount = isLast ? 0 : total - start - shown.length;
  const cells = shown.length + (moreCount > 0 ? 1 : 0);
  const fit = fitGrid(cells, w, h);
  const gridW = fit.cols * fit.tileW + GRID_GAP * (fit.cols - 1);
  const gridH = fit.rows * fit.tileH + GRID_GAP * (fit.rows - 1);
  const ox = Math.max(0, Math.round((w - gridW) / 2));
  const oy = Math.max(0, Math.round((h - gridH) / 2));
  const size = tileSizeFor(fit.tileW, paged);
  const at = (i: number) => ({
    x: ox + (i % fit.cols) * (fit.tileW + GRID_GAP),
    y: oy + Math.floor(i / fit.cols) * (fit.tileH + GRID_GAP),
  });
  const slots: TileSlot[] = shown.map((id, i) => ({ id, ...at(i), w: fit.tileW, h: fit.tileH, size: cells === 1 ? "lg" : size }));
  const more = moreCount > 0 ? { ...at(shown.length), w: fit.tileW, h: fit.tileH, count: moreCount } : null;
  // Одна плитка — на весь контейнер (как раньше `size-full`).
  if (cells === 1 && slots[0]) Object.assign(slots[0], { x: 0, y: 0, w, h, size: "lg" as const });
  return { slots, more, contentH: h, pages, page: safePage, start, perPage: paged ? perPageTiles : perPage };
}

/** Крупный план слева, остальные — колонкой справа; что не поместилось — «+N». */
export function planSpeaker(ids: readonly string[], focusId: string, w: number, h: number): GridPlan {
  const railW = 190;
  const mainW = Math.max(0, w - railW - 12);
  const rest = ids.filter((id) => id !== focusId);
  const tileW = railW;
  const tileH = Math.round(railW / ASPECT);
  const fits = Math.max(1, Math.floor((h + RAIL_GAP) / (tileH + RAIL_GAP)));
  const overflow = rest.length > fits;
  const shown = overflow ? rest.slice(0, fits - 1) : rest;
  const slots: TileSlot[] = [{ id: focusId, x: 0, y: 0, w: mainW, h, size: "lg" }];
  shown.forEach((id, i) => slots.push({ id, x: mainW + 12, y: i * (tileH + RAIL_GAP), w: tileW, h: tileH, size: "sm" }));
  const more = overflow
    ? { x: mainW + 12, y: shown.length * (tileH + RAIL_GAP), w: tileW, h: tileH, count: rest.length - shown.length }
    : null;
  return { slots, more, contentH: h, pages: 1, page: 0, start: 0, perPage: fits };
}

/**
 * Колонка рядом с доской/демонстрацией/заданием (ширина — у контейнера).
 * Свёрнута: сколько помещается по высоте, последняя клетка — «+N»
 * (по нажатию колонка разворачивается и прокручивается).
 */
export function planRail(ids: readonly string[], w: number, h: number, expanded: boolean): GridPlan {
  const tileW = w;
  const tileH = Math.round(w / ASPECT);
  const fits = Math.max(1, Math.floor((h + RAIL_GAP) / (tileH + RAIL_GAP)));
  const overflow = !expanded && ids.length > fits;
  const shown = overflow ? ids.slice(0, fits - 1) : ids;
  const slots: TileSlot[] = shown.map((id, i) => ({ id, x: 0, y: i * (tileH + RAIL_GAP), w: tileW, h: tileH, size: "sm" }));
  const more = overflow ? { x: 0, y: shown.length * (tileH + RAIL_GAP), w: tileW, h: tileH, count: ids.length - shown.length } : null;
  const contentH = (shown.length + (more ? 1 : 0)) * (tileH + RAIL_GAP) - RAIL_GAP;
  return { slots, more, contentH, pages: 1, page: 0, start: 0, perPage: fits };
}

/**
 * Телефон в портрете: крупный план (говорящий/учитель) и лента 3:4 под ним.
 * Без `focusId` (лента под доской) — только лента во всю высоту контейнера.
 */
export function planStrip(ids: readonly string[], focusId: string | null, w: number, h: number): GridPlan {
  const rest = focusId ? ids.filter((id) => id !== focusId) : [...ids];
  const gap = 8;
  const cellW = Math.min(STRIP_MAX_TILE_W, Math.floor((w - gap * (STRIP_VISIBLE - 1)) / STRIP_VISIBLE));
  const cellH = Math.round((cellW * 4) / 3);
  const stripH = rest.length > 0 ? cellH : 0;
  const slots: TileSlot[] = [];
  if (focusId) slots.push({ id: focusId, x: 0, y: 0, w, h: Math.max(0, h - (stripH ? stripH + gap : 0)), size: "lg" });
  const overflow = rest.length > STRIP_VISIBLE;
  const shown = overflow ? rest.slice(0, STRIP_VISIBLE - 1) : rest;
  const y = focusId ? h - stripH : 0;
  shown.forEach((id, i) => slots.push({ id, x: i * (cellW + gap), y, w: cellW, h: cellH, size: "xs" }));
  const more = overflow ? { x: shown.length * (cellW + gap), y, w: cellW, h: cellH, count: rest.length - shown.length } : null;
  return { slots, more, contentH: focusId ? h : cellH, pages: 1, page: 0, start: 0, perPage: STRIP_VISIBLE };
}

/** Окно учителя поверх задания — одна плитка на весь контейнер окна. */
export function planPip(id: string, w: number, h: number, small: boolean): GridPlan {
  return { slots: [{ id, x: 0, y: 0, w, h, size: small ? "xs" : "sm" }], more: null, contentH: h, pages: 1, page: 0, start: 0, perPage: 1 };
}
