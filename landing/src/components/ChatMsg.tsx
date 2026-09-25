import * as React from "react";
import { cn } from "@/lib/utils";
import { useReveal } from "@/hooks/useReveal";

/**
 * Сообщение чата: при появлении в поле зрения сначала «печатает…», затем
 * сообщение выезжает. Место под сообщение зарезервировано — вёрстка не прыгает.
 */
export function ChatMsg({
  delay = 0,
  typingMs = 800,
  header,
  className,
  children,
}: {
  delay?: number;
  typingMs?: number;
  header?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>({ threshold: 0.6 });
  const [phase, setPhase] = React.useState<"idle" | "typing" | "shown">("idle");
  React.useEffect(() => {
    if (!visible) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setPhase("shown");
    const t1 = setTimeout(() => setPhase("typing"), delay);
    const t2 = setTimeout(() => setPhase("shown"), delay + typingMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, delay, typingMs]);

  return (
    <div ref={ref} className={cn("flex flex-col gap-[3px]", className)}>
      {header ? (
        <div className={cn("transition-opacity duration-300", phase === "idle" ? "opacity-0" : "opacity-100")}>{header}</div>
      ) : null}
      <div className="relative">
        <div className={cn(phase === "shown" ? "msg-in" : "invisible")}>{children}</div>
        {phase === "typing" ? (
          <span className="typing absolute left-0 top-0 fade-in" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        ) : null}
      </div>
    </div>
  );
}
