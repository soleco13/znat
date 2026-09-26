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
 * вскоре после выхода; после `STICKY_AFTER_RELAPSES` срывов по одному
 * таймеру уже не выходим.
 *
 * Но из режима всегда выходим по положительному доказательству хорошей связи
 * (`isStrongGood`): пинги доски стабильно быстрые и тишина по плохим
 * признакам, либо LiveKit оценивает связь как отличную. Раньше режим после
 * срывов закреплялся до перезагрузки страницы — ученик переключился на
 * хороший Wi-Fi, а демонстрация так и шла нижним слоем, размыто (2026-09-26).
 * По замерам: Wi-Fi → сервер ~80 мс, мобильная сеть с потерями в
 * экономном режиме 130–290 мс — порог `STRONG_RTT_MS` их разделяет.
 */

const RECOVER_MIN_MS = 60_000;
const RECOVER_MAX_MS = 15 * 60_000;
/** Вход позже этого после выхода — новый эпизод, удержание сбрасывается. */
const RELAPSE_WINDOW_MS = 10 * 60_000;
const STICKY_AFTER_RELAPSES = 2;
const TICK_MS = 2000;
/** Хорошая связь «доказана»: столько быстрых пингов подряд за окно и ни одного медленного. */
const STRONG_RTT_MS = 200;
const STRONG_SAMPLES = 8;
const STRONG_WINDOW_MS = 30_000;

type Listener = () => void;

class LinkQuality {
  private poor = false;
  private lastBadAt = 0;
  private recoverMs = RECOVER_MIN_MS;
  private leftAt = 0;
  private relapses = 0;
  private sticky = false;
  private rtts: { at: number; rtt: number }[] = [];
  private excellentSince = 0;
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

  /** RTT пинга доски — материал для «доказательства» хорошей связи. */
  reportRtt(rtt: number, now = Date.now()): void {
    this.rtts.push({ at: now, rtt });
    if (this.rtts.length > 20) this.rtts.shift();
    this.evaluate(now);
  }

  /** LiveKit: отличная связь сейчас (`true`) или нет. */
  reportMediaExcellent(excellent: boolean, now = Date.now()): void {
    if (!excellent) this.excellentSince = 0;
    else if (!this.excellentSince) this.excellentSince = now;
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

  private isStrongGood(now: number): boolean {
    if (now - this.lastBadAt < STRONG_WINDOW_MS) return false;
    const recent = this.rtts.filter((s) => now - s.at < STRONG_WINDOW_MS);
    const pingsGood = recent.length >= STRONG_SAMPLES && recent.every((s) => s.rtt < STRONG_RTT_MS);
    const mediaGood = this.excellentSince > 0 && now - this.excellentSince >= STRONG_WINDOW_MS;
    return pingsGood || mediaGood;
  }

  private evaluate(now = Date.now()): void {
    const badRecently = this.lastBadAt > 0 && now - this.lastBadAt < this.recoverMs;
    let next: boolean;
    if (this.poor) {
      next = !(this.isStrongGood(now) || (!this.sticky && !badRecently));
    } else {
      // Входим только по плохому признаку, случившемуся ПОСЛЕ выхода.
      next = badRecently && this.lastBadAt > this.leftAt;
    }
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
      if (this.isStrongGood(now)) {
        // Связь по-настоящему хорошая (сменилась сеть) — прошлые срывы не в счёт.
        this.sticky = false;
        this.relapses = 0;
        this.recoverMs = RECOVER_MIN_MS;
      }
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
