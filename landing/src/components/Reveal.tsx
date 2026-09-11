import * as React from "react";
import { cn } from "@/lib/utils";
import { useReveal } from "@/hooks/useReveal";

type RevealProps = React.HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "section" | "li" | "span" | "p" | "figure" | "ul";
  /** Задержка появления, мс — для каскада внутри группы. */
  delay?: number;
};

/** Обёртка «плавное появление при скролле». */
export function Reveal({ as = "div", delay = 0, className, style, children, ...props }: RevealProps) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const Comp = as as React.ElementType;
  return (
    <Comp
      ref={ref}
      data-visible={visible}
      className={cn("reveal", className)}
      style={{ ...style, ["--reveal-delay" as string]: `${delay}ms` }}
      {...props}
    >
      {children}
    </Comp>
  );
}
