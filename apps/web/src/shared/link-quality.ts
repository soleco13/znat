import { useSyncExternalStore } from "react";

/**
 * Единое «связь этого устройства плохая» для всего урока: доска (пинг по
 * своему каналу, board-link.ts) и медиа (оценка LiveKit, PoorLinkMedia.tsx)
 * сообщают сюда плохие признаки и обе читают отсюда режим. Раньше у них были
 * независимые детекторы, переключались в разное время — волны накладывались.
 *
 * Главная трудность — выход. В экономном режиме канал разгружен, и связь
 * выглядит хорошей; вышли — канал снова забился, через секунды вход обратно.
 * На живом телефоне (МегаФон, 2026-09-26) при удержании 20 с режим
 * переключался каждые 6–60 с: каждое переключение — «волна» на доске.
 * Поэтому: удержание начинается с минуты и удваивается при каждом срыве
 * вскоре после выхода; после `STICKY_AFTER_RELAPSES` срывов режим остаётся
 * до перезагрузки страницы — сеть этого устройства уже показала, что обычный
 * режим ей не по силам.
 */

const RECOVER_MIN_MS = 60_000;
const RECOVER_MAX_MS = 15 * 60_000;
/** Вход позже этого после выхода — новый эпизод, удержание сбрасывается. */
const RELAPSE_WINDOW_MS = 10 * 60_000;
const STICKY_AFTER_RELAPSES = 2;
const TICK_MS = 2000;

type Listener = () => void;

class LinkQuality {
  private poor = false;
  private lastBadAt = 0;
  private recoverMs = RECOVER_MIN_MS;
  private leftAt = 0;
  private relapses = 0;
  private sticky = false;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  get isPoor(): boolean {
    return this.poor;
  }

  /** Плохой признак от любого источника: медленный/потерянный пинг, обрыв, Poor у LiveKit. */
  reportBad(now = Date.now()): void {
    this.lastBadAt = now;
    this.evaluate(now);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (!this.timer) this.timer = setInterval(() => this.evaluate(), TICK_MS);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };

  getSnapshot = (): boolean => this.poor;

  private evaluate(now = Date.now()): void {
    const next = this.sticky || (this.lastBadAt > 0 && now - this.lastBadAt < this.recoverMs);
    if (next === this.poor) return;
    if (next) {
      const relapse = this.leftAt > 0 && now - this.leftAt < RELAPSE_WINDOW_MS;
      if (relapse) {
        this.relapses += 1;
        this.recoverMs = Math.min(this.recoverMs * 2, RECOVER_MAX_MS);
        if (this.relapses >= STICKY_AFTER_RELAPSES) this.sticky = true;
      } else {
        this.relapses = 0;
        this.recoverMs = RECOVER_MIN_MS;
      }
    } else {
      this.leftAt = now;
    }
    this.poor = next;
    for (const listener of this.listeners) listener();
  }
}

export const linkQuality = new LinkQuality();

/** `true`, пока связь устройства плохая (единый режим для доски и медиа). */
export function useLinkPoor(): boolean {
  return useSyncExternalStore(linkQuality.subscribe, linkQuality.getSnapshot);
}
