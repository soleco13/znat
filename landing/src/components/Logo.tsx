import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";

/** Логотип «Матис» — как в приложении: знак из фирменного лоадера + название. */
export function Logo({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {mark ? <BrandMark className="size-8 text-primary" /> : null}
      <span className="text-[17px] font-heavy tracking-head text-foreground">
        Матис
      </span>
    </span>
  );
}
