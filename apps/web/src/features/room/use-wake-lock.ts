import { useEffect } from "react";

import { track } from "@/shared/telemetry";

/** Минимальная форма Screen Wake Lock API — в lib.dom TypeScript его может не быть. */
interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** Повторный запрос после отказа — не чаще (отказ без видимой страницы или из-за режима энергосбережения). */
const RETRY_AFTER_ERROR_MS = 30_000;

/**
 * Не даёт экрану погаснуть, пока участник на уроке. Ученик часто только
 * слушает и не касается телефона: экран гас через 30–60 с, iOS усыплял
 * страницу, камера и звук останавливались, а через ~90 с сервер выводил
 * ученика из урока.
 *
 * Браузер сам снимает блокировку, когда вкладка уходит в фон, — запрашиваем
 * снова при возврате (`visibilitychange`). Нет API (старый Safari, часть
 * встроенных браузеров) или отказ — молча живём без него: урок от этого не
 * зависит, пользователю ничего не показываем. Safari на iOS поддерживает API
 * с 16.4 (в установленном на экран веб-приложении — с 18.4).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let requesting = false;
    let stopped = false;
    let lastErrorAt = 0;
    let reported = false;

    const acquire = async () => {
      if (stopped || requesting || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      if (lastErrorAt && Date.now() - lastErrorAt < RETRY_AFTER_ERROR_MS) return;
      requesting = true;
      try {
        const next = await api.request("screen");
        if (stopped) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch (err) {
        lastErrorAt = Date.now();
        // Один раз за урок — чтобы видеть в логах устройства без поддержки.
        if (!reported) {
          reported = true;
          track("client_error", { area: "wake_lock", message: err instanceof Error ? err.name : String(err) });
        }
      } finally {
        requesting = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    // Safari иногда снимает блокировку без смены видимости (блокировка экрана
    // кнопкой, звонок) — после возврата первое касание вернёт её.
    window.addEventListener("pointerdown", onVisibility, { passive: true });

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onVisibility);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) void held.release().catch(() => undefined);
    };
  }, [active]);
}
