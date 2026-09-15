import { useEffect, useState } from "react";

// Совпадает с брейкпоинтом `md` Tailwind: ниже — мобильная раскладка урока.
const QUERY = "(max-width: 767px)";

export function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
