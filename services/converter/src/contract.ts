/**
 * Контракт очереди конвертации — ЛОКАЛЬНАЯ КОПИЯ.
 *
 * Канонический источник — `packages/shared/src/decks.ts` (`CONVERT_QUEUE_NAME`,
 * `ConvertJobData`, `ConvertJobResult`, `ConvertJobProgress`). Конвертер —
 * отдельно разворачиваемый контейнер и СОЗНАТЕЛЬНО не тянет workspace-пакет
 * `@school/shared` (у которого `main` — TS-исходник, не собранный JS): держать
 * его рантайм максимально тонким. При изменении контракта в shared — синхронно
 * править здесь. Дублируется ~25 строк типов (в рантайме стёрты) + одна строка
 * имени очереди — тот же контролируемый дубляж, что canvas↔rooms в Э3.1.
 */

export const CONVERT_QUEUE_NAME = "deck-convert";

export type DeckSourceMimeType =
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/vnd.oasis.opendocument.presentation"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/pdf";

export interface ConvertJobData {
  deckId: string;
  schoolId: string;
  sourceStorageKey: string;
  sourceMimeType: DeckSourceMimeType;
}

/** Слово текстового слоя слайда (Э4.8). x/y/w/h — доли ширины/высоты слайда (0..1), не пиксели. */
export interface SlideTextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ConvertedSlide {
  index: number;
  imageStorageKey: string;
  thumbStorageKey: string;
  width: number;
  height: number;
  textLayer: SlideTextBox[] | null;
}

export interface ConvertJobResult {
  slideCount: number;
  slides: ConvertedSlide[];
  /**
   * Э4.7: исходник — PDF, отдан браузеру как есть (pdf.js рендерит страницы).
   * Воркер только просканировал ClamAV и посчитал страницы: `slides` пуст,
   * `slideCount` — число страниц.
   */
  pdf?: boolean;
}

export interface ConvertJobProgress {
  done: number;
  total: number;
}
