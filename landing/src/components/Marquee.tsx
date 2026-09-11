import * as React from "react";
import { cn } from "@/lib/utils";

/** Бесконечная бегущая строка. Дублирует детей ×2 для бесшовной петли. */
export function Marquee({
  children,
  className,
  durationSec = 34,
  reverse = false,
}: {
  children: React.ReactNode;
  className?: string;
  durationSec?: number;
  reverse?: boolean;
}) {
  return (
    <div className={cn("marquee-mask pause-on-hover overflow-hidden", className)}>
      <div
        className="marquee-track items-center py-1"
        style={{
          ["--marquee-duration" as string]: `${durationSec}s`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        {children}
        <span aria-hidden className="contents">
          {children}
        </span>
      </div>
    </div>
  );
}
