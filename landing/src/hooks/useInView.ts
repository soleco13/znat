import { useEffect, useRef, useState } from "react";

/** Находится ли элемент в поле зрения сейчас (не «один раз», как useReveal) — чтобы ставить эффекты на паузу вне экрана. */
export function useInView<T extends HTMLElement = HTMLDivElement>(rootMargin = "100px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return { ref, inView };
}

/**
 * Прогресс прохождения элемента через экран (0 → 1) пишется в CSS-переменную
 * `--sp` без перерисовок React. Работает только пока элемент виден и без
 * `prefers-reduced-motion`.
 */
export function useScrollVar<T extends HTMLElement = HTMLDivElement>(name = "--sp", from = 0.95, to = 0.35) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty(name, "1");
      return;
    }
    let raf = 0;
    let live = true;
    const calc = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 — верх элемента у нижней части экрана (from), 1 — поднялся до `to` высоты экрана.
      const p = (vh * from - r.top) / (vh * (from - to));
      el.style.setProperty(name, String(Math.min(1, Math.max(0, p))));
    };
    const onScroll = () => {
      if (live && !raf) raf = requestAnimationFrame(calc);
    };
    const io = new IntersectionObserver(([e]) => {
      live = !!e?.isIntersecting;
      if (live) onScroll();
    }, { rootMargin: "200px" });
    io.observe(el);
    calc();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [name, from, to]);
  return ref;
}
