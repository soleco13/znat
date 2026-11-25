import { useEffect, useState } from "react";

/**
 * Подписка на media-query (для выбора десктопного/мобильного окна урока).
 * Первый рендер всегда с `initial` — так же, как в предрендеренном HTML
 * (src/entries/prerender.tsx), иначе разметка при «оживлении» разойдётся.
 * Настоящее значение приходит сразу после монтирования.
 */
export function useMedia(query: string, initial = false) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
