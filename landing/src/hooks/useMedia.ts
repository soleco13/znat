import { useEffect, useState } from "react";

/** Подписка на media-query (для выбора десктопного/мобильного окна урока). */
export function useMedia(query: string, initial = false) {
  const [match, setMatch] = useState(() =>
    typeof window === "undefined" ? initial : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
