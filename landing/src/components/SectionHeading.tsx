import * as React from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

/** Единая шапка секции: eyebrow + заголовок + подзаголовок, по центру. */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "mx-auto max-w-2xl items-center text-center" : "max-w-2xl",
        className,
      )}
    >
      {eyebrow ? (
        <Reveal as="span" className="eyebrow">
          {eyebrow}
        </Reveal>
      ) : null}
      <Reveal
        as="div"
        delay={60}
        className="text-balance text-[30px] font-heavy leading-[1.12] tracking-tightest text-foreground sm:text-[40px]"
      >
        {title}
      </Reveal>
      {subtitle ? (
        <Reveal as="div" delay={120} className="text-[17px] leading-relaxed text-muted-foreground">
          {subtitle}
        </Reveal>
      ) : null}
    </div>
  );
}
