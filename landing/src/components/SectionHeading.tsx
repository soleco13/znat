import * as React from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

/**
 * Заголовок секции: крупный, без «эйброу»-плашек и нумерации.
 * Появляется одним спокойным движением — пословная анимация только у h1 в hero.
 */
export function SectionHeading({
  title,
  subtitle,
  className,
  tone = "light",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <Reveal className={cn("flex max-w-3xl flex-col gap-5", className)}>
      <h2 className={cn("text-h2 text-balance", dark ? "text-white" : "text-foreground")}>{title}</h2>
      {subtitle ? (
        <p className={cn("max-w-xl text-body", dark ? "text-white/70" : "text-muted-foreground")}>{subtitle}</p>
      ) : null}
    </Reveal>
  );
}
