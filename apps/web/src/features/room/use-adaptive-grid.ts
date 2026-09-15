import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface GridLayout {
  /** Число колонок для текущего размера контейнера и количества плиток. */
  cols: number;
  /** Ребро квадратной плитки в px (для точного центрирования). */
  tile: number;
}

/**
 * Э12.7 §6.2 — раскладка плиток участников «как в Zoom/Телемост/КонтурТолк»:
 * все плитки квадратные и одинаковые, при росте числа участников
 * уменьшаются пропорционально, стараясь занять максимум площади.
 *
 * Для каждого возможного числа колонок c ∈ [1..count] считаем ребро
 * квадрата `min(W/c, H/ceil(count/c))` и берём c с наибольшим ребром.
 * Пересчёт — на ResizeObserver контейнера и при изменении `count`.
 */
export function useAdaptiveGrid(
  ref: React.RefObject<HTMLElement | null>,
  count: number,
  gap = 8,
  /** Ширина/высота плитки; `tile` в результате — ширина. */
  aspect = 1,
): GridLayout {
  const [layout, setLayout] = useState<GridLayout>({ cols: 1, tile: 0 });
  const rafRef = useRef<number | null>(null);

  const measure = () => {
    const el = ref.current;
    if (!el || count === 0) {
      setLayout({ cols: 1, tile: 0 });
      return;
    }
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;

    let best = { cols: 1, tile: 0 };
    for (let cols = 1; cols <= count; cols += 1) {
      const rows = Math.ceil(count / cols);
      const tile = Math.min(
        (w - gap * (cols - 1)) / cols,
        ((h - gap * (rows - 1)) / rows) * aspect,
      );
      if (tile > best.tile) best = { cols, tile };
    }
    setLayout(best);
  };

  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, count, gap, aspect]);

  return layout;
}
