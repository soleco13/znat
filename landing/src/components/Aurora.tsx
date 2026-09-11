import { cn } from "@/lib/utils";

/**
 * Мягкое «северное сияние» из размытых блобов + тонкая сетка. Живой, но
 * ненавязчивый фон для hero и CTA-секций. `pointer-events-none`, `aria-hidden`.
 */
export function Aurora({
  className,
  variant = "hero",
}: {
  className?: string;
  variant?: "hero" | "band";
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {variant === "hero" ? (
        <>
          <div
            className="aurora-blob left-[8%] top-[-8%] size-[42vw] max-w-[560px]"
            style={{ background: "radial-gradient(circle at 30% 30%, #93b4ff, transparent 65%)" }}
          />
          <div
            className="aurora-blob right-[2%] top-[6%] size-[38vw] max-w-[520px] [animation-delay:-7s]"
            style={{ background: "radial-gradient(circle at 60% 40%, #7fe8dd, transparent 65%)" }}
          />
          <div
            className="aurora-blob left-[36%] top-[34%] size-[36vw] max-w-[480px] opacity-40 [animation-delay:-13s]"
            style={{ background: "radial-gradient(circle at 50% 50%, #c9b8ff, transparent 65%)" }}
          />
          <div className="absolute inset-0 bg-grid-line [background-size:64px_64px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_20%,transparent_75%)]" />
        </>
      ) : (
        <>
          <div
            className="aurora-blob left-[-6%] top-[-40%] size-[36vw] max-w-[520px] opacity-70"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.55), transparent 62%)" }}
          />
          <div
            className="aurora-blob right-[-4%] bottom-[-45%] size-[34vw] max-w-[480px] opacity-60 [animation-delay:-9s]"
            style={{ background: "radial-gradient(circle, rgba(125,232,221,0.6), transparent 62%)" }}
          />
        </>
      )}
    </div>
  );
}
