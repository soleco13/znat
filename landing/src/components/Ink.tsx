import * as React from "react";
import { cn } from "@/lib/utils";
import { useReveal } from "@/hooks/useReveal";

const delay = (ms: number) => ({ ["--d" as string]: `${ms}ms` }) as React.CSSProperties;

/** Жёлтый маркер, который «проводят» по тексту, когда он появляется в поле зрения. */
export function Mark({ children, d = 0, className }: { children: React.ReactNode; d?: number; className?: string }) {
  const { ref, visible } = useReveal<HTMLSpanElement>({ threshold: 0.6 });
  return (
    <span ref={ref} data-visible={visible} className={cn("mark", className)} style={delay(d)}>
      {children}
    </span>
  );
}

/** Зачёркивание красным, переносится по строкам (для длинных фраз). */
export function Strike({ children, d = 0, className }: { children: React.ReactNode; d?: number; className?: string }) {
  const { ref, visible } = useReveal<HTMLSpanElement>({ threshold: 0.6 });
  return (
    <span ref={ref} data-visible={visible} className={cn("strike", className)} style={delay(d)}>
      {children}
    </span>
  );
}

/** Красная линия карандашом: зачёркивание («strike») или подчёркивание («under»). */
export function Pencil({
  children,
  kind = "strike",
  d = 0,
  color = "#e03131",
  className,
}: {
  children: React.ReactNode;
  kind?: "strike" | "under";
  d?: number;
  color?: string;
  className?: string;
}) {
  const { ref, visible } = useReveal<HTMLSpanElement>({ threshold: 0.6 });
  return (
    <span ref={ref} data-visible={visible} className={cn("relative inline-block", className)}>
      {children}
      <svg
        aria-hidden
        className="pointer-events-none absolute left-[-3%] w-[106%] overflow-visible"
        style={kind === "strike" ? { top: "52%", height: "0.2em" } : { bottom: "-0.14em", height: "0.22em" }}
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
      >
        <path
          className="ink"
          style={{ ["--len" as string]: 120, ["--d" as string]: `${d}ms`, ["--dur" as string]: "0.8s" } as React.CSSProperties}
          d={kind === "strike" ? "M1 6 C 22 2, 48 9, 70 4 S 96 5, 99 3" : "M1 5 C 20 8, 40 1, 62 6 S 90 3, 99 6"}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

/** Овал вокруг слова — как обводят на проверенной работе. */
export function Ring({
  children,
  d = 0,
  color = "#e03131",
  className,
}: {
  children: React.ReactNode;
  d?: number;
  color?: string;
  className?: string;
}) {
  const { ref, visible } = useReveal<HTMLSpanElement>({ threshold: 0.6 });
  return (
    <span ref={ref} data-visible={visible} className={cn("relative inline-block px-[0.18em]", className)}>
      {children}
      <svg
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
        style={{ width: "128%", height: "205%" }}
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
      >
        <path
          className="ink"
          style={{ ["--len" as string]: 300, ["--d" as string]: `${d}ms`, ["--dur" as string]: "1.1s" } as React.CSSProperties}
          d="M50 3 C 84 1, 99 14, 97 27 C 95 42, 70 48, 46 47 C 18 46, 2 36, 4 23 C 6 10, 28 4, 62 5"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

/**
 * Слова заголовка выезжают из-под линии по одному. Строки — по словам, узлы
 * (Mark/Pencil/…) — как одно целое.
 */
export function Words({
  children,
  step = 45,
  base = 0,
  as: Comp = "span",
  className,
}: {
  children: React.ReactNode;
  step?: number;
  base?: number;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
  className?: string;
}) {
  const { ref, visible } = useReveal<HTMLElement>({ threshold: 0.3 });
  let i = 0;
  const out: React.ReactNode[] = [];
  React.Children.forEach(children, (child, ci) => {
    if (typeof child === "string") {
      child.split(/(\s+)/).forEach((tok, ti) => {
        if (!tok) return;
        if (/^\s+$/.test(tok)) {
          out.push(" ");
          return;
        }
        out.push(
          <span key={`${ci}-${ti}`} className="word">
            <span style={delay(base + i++ * step)}>{tok}</span>
          </span>,
        );
      });
    } else {
      out.push(
        <span key={ci} className="word word-free">
          <span style={delay(base + i++ * step)}>{child}</span>
        </span>,
      );
    }
  });
  const C = Comp as React.ElementType;
  return (
    <C ref={ref} data-visible={visible} className={className}>
      {out}
    </C>
  );
}
