import { useEffect } from "react";

/**
 * Урок на телефоне и планшете — без масштаба страницы (запрос 2026-10-17):
 * ученики, часто дети, случайно щипком или двойным тапом увеличивали
 * страницу и не понимали, как вернуть её обратно.
 *
 *  - viewport `maximum-scale=1, user-scalable=no` — Android; на iOS ещё и
 *    убирает автоувеличение при фокусе на поле ввода (чат);
 *  - `touch-action: pan-x pan-y` на корне (класс `no-page-zoom`) — щипок и
 *    двойной тап в Safari iOS 13+, который `user-scalable=no` игнорирует;
 *  - отмена `gesturestart` — щипок в старых Safari.
 *
 * Доска (Excalidraw) приближает своим кодом (`touch-action: none` на холсте),
 * это продолжает работать. Только пока смонтирован урок/вход в урок —
 * кабинет, учебник и записи масштабируются как обычно.
 */
const LOCKED = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";

export function useLockPageZoom(active = true) {
  useEffect(() => {
    if (!active) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const prev = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", LOCKED);
    const root = document.documentElement;
    root.classList.add("no-page-zoom");
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", block, { passive: false });
    return () => {
      if (meta && prev !== null) meta.setAttribute("content", prev);
      root.classList.remove("no-page-zoom");
      document.removeEventListener("gesturestart", block);
    };
  }, [active]);
}
