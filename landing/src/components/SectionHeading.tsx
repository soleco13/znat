import * as React from "react";
import { cn } from "@/lib/utils";
import { Words } from "./Ink";
import { Reveal } from "./Reveal";

/** Заголовок секции: крупный, слова выезжают по одному; без «эйброу»-плашек и нумерации. */
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
    <div className={cn("flex max-w-3xl flex-col gap-5", className)}>
      <Words
        as="h2"
        className={cn(
          "text-balance text-[34px] font-black leading-[1.05] tracking-tightest sm:text-[52px]",
          dark ? "text-white" : "text-foreground",
        )}
      >
        {title}
      </Words>
      {subtitle ? (
        <Reveal
          as="div"
          delay={200}
          className={cn("max-w-xl text-[17px] leading-relaxed", dark ? "text-white/65" : "text-muted-foreground")}
        >
          {subtitle}
        </Reveal>
      ) : null}
    </div>
  );
}
