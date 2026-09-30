import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Лоадер содержимого урока: камера, демонстрация экрана, доска, задание.
 * Тот же вид, что у загрузки своей камеры (пульсирующее кольцо + спиннер),
 * чтобы на плохой связи вместо пустого места было видно: идёт загрузка, урок
 * не сломался.
 *
 * - Появляется с задержкой 300 мс плавно — на быстрой связи не мигает.
 * - `prefers-reduced-motion`: без пульсации и вращения, остаются значок и текст.
 * - Смысл не только цветом: подпись текстом (`label`), `role="status"` для
 *   скринридера. На маленьких плитках подпись только для скринридера.
 */
export function MediaLoader({
  label,
  tone = "dark",
  size = "md",
  className,
}: {
  label: string;
  /** `dark` — поверх видео (плитки на тёмном фоне), `light` — доска, задание. */
  tone?: "dark" | "light";
  /** `sm` — маленькие плитки ленты, подпись только для скринридера. */
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const showLabel = size !== "sm";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3",
        "animate-in fade-in-0 fill-mode-both duration-300 [animation-delay:300ms] motion-reduce:animate-none",
        tone === "dark" ? "bg-slate-900" : "bg-card",
        className,
      )}
    >
      <span className="relative inline-flex items-center justify-center">
        <span
          className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping"
          style={{ animationDuration: "1.4s" }}
          aria-hidden
        />
        <span
          className={cn(
            "relative flex items-center justify-center rounded-full text-primary ring-1 ring-primary/25",
            tone === "dark" ? "bg-primary/15" : "bg-primary/10",
            size === "sm" && "size-7",
            size === "md" && "size-10",
            size === "lg" && "size-14",
          )}
        >
          <Loader2
            className={cn(
              "motion-safe:animate-spin",
              size === "sm" && "size-3.5",
              size === "md" && "size-5",
              size === "lg" && "size-7",
            )}
            aria-hidden
          />
        </span>
      </span>
      {showLabel ? (
        <span
          className={cn(
            "max-w-[80%] text-center font-medium",
            size === "lg" ? "text-sm" : "text-xs",
            tone === "dark" ? "text-slate-200" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}
