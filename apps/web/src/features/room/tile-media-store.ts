import { create } from "zustand";

/**
 * Состояние видео плиток, которое должно пережить перемонтирование сетки:
 * `RoomVideoGrid` создаётся заново при каждой смене сцены (сетка → лента у
 * доски → окно учителя над заданием). Раньше при этом терялись пришедшие
 * кадры — все плитки снова показывали «Камера загружается», — и последний
 * говоривший: крупный план на телефоне перескакивал на учителя.
 *
 * Сбрасывается вместе со страницей урока (F5) — это кеш, не источник истины.
 */
interface TileMediaState {
  /** `trackSid` камер, от которых уже пришёл кадр. */
  loadedSids: ReadonlySet<string>;
  /** Когда камера стала включённой без кадра (`trackSid` или `identity:pending`) — для предела лоадера. */
  waitingSince: ReadonlyMap<string, number>;
  /** Последний говоривший (кроме себя) — кого показывать крупно. */
  lastSpeakerId: string | null;
  markLoaded: (sid: string) => void;
  noteWaiting: (key: string, at: number) => void;
  clearWaiting: (key: string) => void;
  setLastSpeaker: (id: string) => void;
}

export const useTileMediaStore = create<TileMediaState>((set) => ({
  loadedSids: new Set(),
  waitingSince: new Map(),
  lastSpeakerId: null,
  markLoaded: (sid) =>
    set((s) => {
      if (s.loadedSids.has(sid)) return s;
      const loadedSids = new Set(s.loadedSids).add(sid);
      if (!s.waitingSince.has(sid)) return { loadedSids };
      const waitingSince = new Map(s.waitingSince);
      waitingSince.delete(sid);
      return { loadedSids, waitingSince };
    }),
  noteWaiting: (key, at) =>
    set((s) => (s.waitingSince.has(key) ? s : { waitingSince: new Map(s.waitingSince).set(key, at) })),
  clearWaiting: (key) =>
    set((s) => {
      if (!s.waitingSince.has(key)) return s;
      const waitingSince = new Map(s.waitingSince);
      waitingSince.delete(key);
      return { waitingSince };
    }),
  setLastSpeaker: (id) => set((s) => (s.lastSpeakerId === id ? s : { lastSpeakerId: id })),
}));

/**
 * Сколько показывать маленький лоадер «видео идёт» поверх знака участника.
 * Дальше (поток на паузе из-за слабого канала, кадр так и не пришёл) — просто
 * знак, без вечного спиннера: для смотрящего это выглядит как выключенная
 * камера, а не как сломанная плитка.
 */
export const TILE_LOADER_MAX_MS = 5_000;
