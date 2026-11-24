import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { BrandMark } from "@/shared/ui/brand-mark";

/**
 * Объёмный знак «Матис» — тот же, что на первом экране лендинга
 * (`landing/src/mark3d/MarkScene.tsx`). Рендерер грузится отдельным чанком
 * после отрисовки страницы; без WebGL, на программной видеокарте, в режиме
 * экономии трафика или после потери контекста — плоский знак. Кадр рисуется
 * только когда что-то движется; вне экрана и в фоновой вкладке GPU не работает.
 */
export function MarkScene({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "flat">("loading");

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    let disposed = false;
    let cleanup = () => {};
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (saveData) {
      setState("flat");
      return;
    }

    import("./renderer.js")
      .then(({ createMarkRenderer }) => {
        if (disposed) return;
        const r = createMarkRenderer(cv, { still: reduced, maxDpr: coarse ? 1.5 : 2 }, () => setState("flat"));
        setState("ready");
        const ro = new ResizeObserver(() => r.resize());
        ro.observe(cv);
        let onScreen = true;
        let pageVisible = document.visibilityState === "visible";
        const sync = () => r.setActive(onScreen && pageVisible);
        const io = new IntersectionObserver(([e]) => {
          onScreen = !!e?.isIntersecting;
          sync();
        });
        io.observe(el);
        const onVis = () => {
          pageVisible = document.visibilityState === "visible";
          sync();
        };
        document.addEventListener("visibilitychange", onVis);
        // Наклон за курсором — только мышь и только если движение не выключено.
        const onMove = (e: PointerEvent) => {
          if (e.pointerType !== "mouse") return;
          const b = el.getBoundingClientRect();
          const x = (e.clientX - (b.left + b.width / 2)) / (window.innerWidth / 2);
          const y = (e.clientY - (b.top + b.height / 2)) / (window.innerHeight / 2);
          r.setPointer(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
        };
        const onLeave = () => r.setPointer(0, 0);
        if (!reduced && !coarse) {
          window.addEventListener("pointermove", onMove, { passive: true });
          document.documentElement.addEventListener("pointerleave", onLeave);
        }
        cleanup = () => {
          ro.disconnect();
          io.disconnect();
          document.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("pointermove", onMove);
          document.documentElement.removeEventListener("pointerleave", onLeave);
          r.destroy();
        };
      })
      .catch(() => {
        if (!disposed) setState("flat");
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div ref={box} aria-hidden className={cn("relative aspect-square", className)}>
      <canvas
        ref={canvas}
        className={cn("absolute inset-0 size-full transition-opacity duration-700", state === "ready" ? "opacity-100" : "opacity-0")}
      />
      {state === "flat" ? (
        <div className="absolute inset-[16%] grid place-items-center">
          <BrandMark className="size-full text-[#3b6cf6]" />
        </div>
      ) : null}
    </div>
  );
}
