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
