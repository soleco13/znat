import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";

/**
 * Объёмный знак на первом экране. Рендерер (`renderer.ts`) грузится отдельным
 * чанком после первой отрисовки страницы — текст и кнопки не ждут WebGL.
 * Место под сцену зарезервировано (квадрат), поэтому при появлении ничего не
 * сдвигается. Без WebGL или после потери контекста — плоский знак.
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

    import("./renderer")
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
      {/* Тень на «полу» под диском — привязывает знак к странице. */}
      <div className="mark-shadow absolute inset-x-[18%] bottom-[4%] h-[9%]" />
      <canvas
        ref={canvas}
        className={cn(
          "absolute inset-0 size-full transition-opacity duration-700 ease-ds",
          state === "ready" ? "opacity-100" : "opacity-0",
        )}
      />
      {state === "flat" ? (
        <div className="absolute inset-[16%] grid place-items-center">
          <BrandMark className="size-full text-primary" />
        </div>
      ) : null}
    </div>
  );
}
