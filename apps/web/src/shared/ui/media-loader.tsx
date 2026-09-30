import { cn } from "@/lib/utils";
import { Loader } from "@/shared/ui/loader";

/**
 * Лоадер содержимого урока: камера, демонстрация экрана, доска, задание.
 * Фирменный лоадер (`Loader`) на месте содержимого, чтобы на плохой связи
 * вместо пустого места было видно: идёт загрузка, урок не сломался.
 *
 * - Появляется с задержкой 300 мс плавно — на быстрой связи не мигает.
 * - `prefers-reduced-motion`: `Loader` стоит на месте, остаются знак и текст.
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
      <Loader
        className={cn(
          tone === "dark" ? "text-white/70" : "text-primary",
          size === "sm" && "size-5",
          size === "md" && "size-8",
          size === "lg" && "size-10",
        )}
      />
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
