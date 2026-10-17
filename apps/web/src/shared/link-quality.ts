import { useEffect, useSyncExternalStore } from "react";

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
/**
 * Хорошая связь «доказана»: столько пингов подряд за окно не выше базового RTT
 * + `STRONG_OVER_BASE_MS` (и не выше `STRONG_RTT_MS` над нулём, если базы ещё
 * нет). Порог относительный (2026-10-17): на далёкой сети с RTT ≈ 400 мс
 * абсолютные 200 мс недостижимы, и ученик навсегда оставался в экономном
 * режиме. Контур Толк в своих метриках прямо пишет: «RTT ~300 может быть
 * нормой, важны скачки».
 */
const STRONG_RTT_MS = 200;
const STRONG_OVER_BASE_MS = 120;
/** Скачок RTT: выше базового на столько — признак перегруженного канала. */
const SPIKE_OVER_BASE_MS = 250;
/** База — минимум RTT за это окно. */
const BASE_WINDOW_MS = 120_000;
const STRONG_SAMPLES = 8;
const STRONG_WINDOW_MS = 30_000;
/** Замер связи из урока (`useLinkProbe`): пустой `/ping` на сервер приложения. */
const PROBE_INTERVAL_MS = 2000;
/**
 * HTTP-пинг идёт по TCP/TLS: на потерях он ждёт повторов и «медленный» даже
 * там, где медиа по UDP в порядке. Поэтому с 2026-10-17 он — только признак
 * полного обрыва (нет ответа `PROBE_TIMEOUT_MS`), а качество медиа решает
 * статистика медиапути (`PoorLinkMedia.useMediaPathQuality`).
 */
const PROBE_TIMEOUT_MS = 2500;
/**
 * После входа в урок и открытия доски браузер качает их код и данные —
 * замеры в это время медленные на любой сети. Раньше это давало ложный
 * экономный режим у зрителя на хорошем Wi-Fi (2026-09-26).
 */
export const LINK_GRACE_MS = 20_000;

type Listener = () => void;

class LinkQuality {
  private poor = false;
  private lastBadAt = 0;
  private lastBadReason = "";
  private recoverMs = RECOVER_MIN_MS;
  private leftAt = 0;
  private relapses = 0;
  private sticky = false;
  private rtts: { at: number; rtt: number }[] = [];
  private baseRtts: { at: number; rtt: number }[] = [];
  private excellentSince = 0;
  private graceUntil = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  get isPoor(): boolean {
    return this.poor;
  }

  /** Последний признак, из-за которого связь считалась плохой (для журнала). */
  get badReason(): string {
    return this.lastBadReason;
  }

  /** Плохие признаки не учитывать `ms` (идёт загрузка — см. `LINK_GRACE_MS`). */
  startGrace(ms = LINK_GRACE_MS, now = Date.now()): void {
    this.graceUntil = Math.max(this.graceUntil, now + ms);
  }

  /** Плохой признак от любого источника: медленный/потерянный пинг, обрыв, Poor у LiveKit. */
  reportBad(reason = "other", now = Date.now()): void {
    if (now < this.graceUntil) return;
    this.lastBadAt = now;
    this.lastBadReason = reason;
    this.evaluate(now);
  }

  /** RTT пинга — материал для «доказательства» хорошей связи и базового RTT. */
  reportRtt(rtt: number, now = Date.now()): void {
    this.rtts.push({ at: now, rtt });
    if (this.rtts.length > 20) this.rtts.shift();
    this.baseRtts.push({ at: now, rtt });
    while (this.baseRtts.length && now - this.baseRtts[0]!.at > BASE_WINDOW_MS) this.baseRtts.shift();
    this.evaluate(now);
  }

  /** Базовый RTT сессии — минимум за последние 2 мин (`null`, пока замеров нет). */
  baseRtt(): number | null {
    return this.baseRtts.length ? Math.min(...this.baseRtts.map((s) => s.rtt)) : null;
  }

  /** RTT — скачок над базовым, а не просто «большой». */
  isRttSpike(rtt: number): boolean {
    const base = this.baseRtt();
    return base !== null && rtt > base + SPIKE_OVER_BASE_MS;
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
    const base = this.baseRtt();
    const limit = base === null ? STRONG_RTT_MS : Math.max(STRONG_RTT_MS, base + STRONG_OVER_BASE_MS);
    const pingsGood = recent.length >= STRONG_SAMPLES && recent.every((s) => s.rtt < limit);
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

/**
 * Замер связи, пока открыт урок: раз в 2 с пустой `/ping` на сервер
 * приложения. Нужен независимо от доски — её пинг есть, только пока доска
 * открыта, а без замеров во время демонстрации экономный режим не мог
 * выключиться даже на хорошей сети (2026-09-26).
 */
export function useLinkProbe(): void {
  useEffect(() => {
    linkQuality.startGrace();
    let inFlight = false;
    const probe = async () => {
      // Фоновая вкладка: браузер душит таймеры и сеть — замер был бы ложным.
      if (document.hidden || inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const startedAt = performance.now();
      try {
        await fetch("/ping", { cache: "no-store", signal: controller.signal });
        linkQuality.reportRtt(performance.now() - startedAt);
      } catch {
        // Нет ответа вовсе — обрыв: это признак плохой связи при любом медиа.
        linkQuality.reportBad("ping_timeout");
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };
    const interval = setInterval(() => void probe(), PROBE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
