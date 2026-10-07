import { useEffect, useState } from "react";

// Совпадает с брейкпоинтом `md` Tailwind: ниже — мобильная раскладка урока.
const NARROW_QUERY = "(max-width: 767px)";
/**
 * Телефон в альбомной ориентации: низкий сенсорный экран. Ширина тут не
 * признак — iPhone 844×390 шире `md` и раньше получал десктопную раскладку
 * (под сцену оставалось ~230 px), а 667×375 — портретную с двумя рядами
 * кнопок снизу. Для него своя раскладка: сцена во всю высоту, кнопки
 * колонкой справа (`RoomPage`).
 */
const PHONE_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 560px) and (pointer: coarse)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Телефон в альбомной ориентации — компактная раскладка урока. */
export function useIsPhoneLandscape(): boolean {
  return useMediaQuery(PHONE_LANDSCAPE_QUERY);
}

/** Портретный телефон: узкая раскладка (лента плиток, нижний лист панелей). */
export function useIsNarrowViewport(): boolean {
  const narrow = useMediaQuery(NARROW_QUERY);
  const phoneLandscape = useMediaQuery(PHONE_LANDSCAPE_QUERY);
  return narrow && !phoneLandscape;
}

/** Окно не уже `px` — например, хватает ли места рейлу камер рядом с учебником. */
export function useMinViewportWidth(px: number): boolean {
  return useMediaQuery(`(min-width: ${px}px)`);
}
