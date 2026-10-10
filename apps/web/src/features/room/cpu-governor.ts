/**
 * Автомат нагрузки своего устройства на уроке: решает, на какой ступени
 * держать свою камеру и демонстрацию, чтобы процессор успевал отдавать звук.
 * Только решение — применяет его `cpu-load.ts`.
 *
 * Главный признак — доля звука, которую микрофон успел отдать кодеру
 * (`media-source.totalSamplesDuration` за интервал, 1 — без потерь). Стенд
 * 2026-10-10, учитель на 0,4 ядра: без видео 1,00; камера — 0,67–0,75 и
 * разборчивость у ученика PESQ 1,3 вместо 3,3. Флаг браузера
 * `qualityLimitationReason = cpu` при этом не ставился ни разу, частота
 * камеры падала лишь с 24 до 17 — по ним одним перегрузку не увидеть.
 * Поэтому они и Compute Pressure — дополнительные признаки.
 *
 * Ступени (что именно меняется — `cpu-load-engine.ts`):
 *  0 — как задала школа (цель: к ней автомат всегда возвращается);
 *  1 — камера 360p одним слоем;
 *  2 — камера 180p/10, демонстрация одним слоем 5 кадр/с, чужие камеры
 *      нижним слоем;
 *  3 — минимум: камера 144p/5. Камера не выключается никогда.
 *
 * Сеть автомат не трогает: признаки — только своего устройства (звук,
 * который микрофон не успел отдать кодеру, — до сети). Плохую связь
 * обрабатывают LiveKit и `PoorLinkMedia`.
 *
 * Состояния: NORMAL (ступень 0), CONSTRAINED (1), CRITICAL (2–3), RECOVERY —
 * ступень только что поднята, идёт проверка. Вниз — после ≥ 4 с устойчивой
 * перегрузки (в том числе через тик), не чаще раза в 6 с. Вверх — по одной ступени после минуты
 * без признаков перегрузки; перегрузка в течение 45 с после подъёма —
 * сразу назад, а следующая попытка ждёт вдвое дольше (до 8 мин), так что
 * слабое устройство не дёргается каждую минуту, но и не застревает внизу:
 * удачный подъём сбрасывает паузу к минуте.
 */

export type GovernorState = "NORMAL" | "CONSTRAINED" | "CRITICAL" | "RECOVERY";
export type PressureLevel = "nominal" | "fair" | "serious" | "critical";

export interface LoadSample {
  now: number;
  /** Доля звука, отданная микрофоном за интервал (1 — без потерь); null — нет данных (микрофон выключен). */
  audioCapture: number | null;
  /** Своё видео ограничено процессором (флаг браузера или камера кодирует меньше половины кадров). */
  videoCpuLimited: boolean;
  /** Compute Pressure API, где он есть. */
  pressure: PressureLevel | null;
  sharing: boolean;
  /** Своя камера или демонстрация публикуются — есть что облегчать. */
  hasVideo: boolean;
}

export interface Decision {
  level: number;
  state: GovernorState;
  changed: boolean;
  /** Почему сменилась ступень (для лога). */
  reason: string | null;
}

export const MAX_LEVEL = 3;
/** Ступень, с которой демонстрация идёт одним слоем, а камера — 180p. */
export const SHARE_LEVEL = 2;

/** Ниже — микрофон теряет звук. Норма на стенде 0,99–1,00. */
export const AUDIO_BAD = 0.93;
/** Не ниже — звук отдаётся полностью. */
export const AUDIO_GOOD = 0.98;
const OVERLOAD_PERSIST_MS = 4_000;
/** Без признаков перегрузки дольше — она закончилась. */
const OVERLOAD_GAP_MS = 3_000;
const STEP_SETTLE_MS = 6_000;
const RECOVER_HOLD_MS = 60_000;
const RECOVER_HOLD_MAX_MS = 8 * 60_000;
const PROBATION_MS = 45_000;

function overloadReason(s: LoadSample): string | null {
  if (s.audioCapture !== null && s.audioCapture < AUDIO_BAD) return "audio_degradation";
  if (s.videoCpuLimited) return "cpu_overload";
  if (s.pressure === "critical") return "cpu_pressure";
  return null;
}

/**
 * Можно пробовать качество выше. Compute Pressure (где браузер его даёт)
 * должен быть спокоен: «serious» на нижней ступени значит, что запаса нет и
 * подъём почти наверняка вернёт провалы звука.
 */
function isHealthy(s: LoadSample): boolean {
  return (
    (s.audioCapture === null || s.audioCapture >= AUDIO_GOOD) &&
    !s.videoCpuLimited &&
    s.pressure !== "serious" &&
    s.pressure !== "critical"
  );
}

export class CpuGovernor {
  level = 0;
  private overloadSince = 0;
  private lastOverloadAt = 0;
  private healthySince = 0;
  private changedAt = 0;
  private holdMs = RECOVER_HOLD_MS;
  private probationUntil = 0;
  private wasSharing = false;

  update(s: LoadSample): Decision {
    const decision = this.step(s);
    this.wasSharing = s.sharing;
    return decision;
  }

  get state(): GovernorState {
    if (this.probationUntil) return "RECOVERY";
    if (this.level === 0) return "NORMAL";
    return this.level === 1 ? "CONSTRAINED" : "CRITICAL";
  }

  private change(level: number, now: number, reason: string): Decision {
    this.level = level;
    this.changedAt = now;
    this.overloadSince = 0;
    this.healthySince = 0;
    return { level, state: this.state, changed: true, reason };
  }

  private step(s: LoadSample): Decision {
    const { now } = s;
    if (this.probationUntil && now >= this.probationUntil) {
      // Подъём выдержал проверку — следующая попытка снова через минуту.
      this.probationUntil = 0;
      this.holdMs = RECOVER_HOLD_MS;
    }

    // Демонстрация на уже перегруженном устройстве: оно и без неё не справлялось.
    if (s.sharing && !this.wasSharing && this.level >= 1 && this.level < SHARE_LEVEL) {
      this.probationUntil = 0;
      return this.change(SHARE_LEVEL, now, "share_while_constrained");
    }

    const reason = overloadReason(s);
    if (reason) {
      this.healthySince = 0;
      if (this.probationUntil && this.level < MAX_LEVEL) {
        // Подняли рано — сразу назад, следующая попытка позже.
        this.probationUntil = 0;
        this.holdMs = Math.min(this.holdMs * 2, RECOVER_HOLD_MAX_MS);
        return this.change(this.level + 1, now, "recovery_failed");
      }
      if (!this.overloadSince) this.overloadSince = now;
      this.lastOverloadAt = now;
      const persistent = now - this.overloadSince >= OVERLOAD_PERSIST_MS;
      const settled = now - this.changedAt >= STEP_SETTLE_MS;
      if (s.hasVideo && this.level < MAX_LEVEL && persistent && settled) {
        const target = s.sharing ? Math.max(this.level + 1, SHARE_LEVEL) : this.level + 1;
        return this.change(Math.min(target, MAX_LEVEL), now, reason);
      }
      return { level: this.level, state: this.state, changed: false, reason: null };
    }

    // Перегрузка через раз — тоже перегрузка: отметка сбрасывается после
    // двух нормальных тиков подряд, а не после первого.
    if (now - this.lastOverloadAt > OVERLOAD_GAP_MS) this.overloadSince = 0;
    if (!isHealthy(s)) {
      this.healthySince = 0;
      return { level: this.level, state: this.state, changed: false, reason: null };
    }
    if (!this.healthySince) this.healthySince = now;
    if (this.level > 0 && !this.probationUntil && now - this.healthySince >= this.holdMs) {
      const decision = this.change(this.level - 1, now, "recovery");
      this.probationUntil = now + PROBATION_MS;
      return { ...decision, state: this.state };
    }
    return { level: this.level, state: this.state, changed: false, reason: null };
  }
}
