import { cn } from "@/lib/utils";

/** Логотип «Матис» — как в приложении: шапочка выпускника в синем скруглённом квадрате. */
export function Logo({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {mark ? (
        <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-[0_6px_16px_-4px_rgba(29,78,216,0.5)]">
          <GradCap className="size-[18px]" />
        </span>
      ) : null}
      <span className="text-[17px] font-heavy tracking-head text-foreground">
        Матис
      </span>
    </span>
  );
}

export function GradCap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 3 2 8l10 4 8-3.2V15h2V7.6L12 3Z"
        fill="currentColor"
      />
      <path
        d="M6 12.4V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-3.6l-6 2.4-6-2.4Z"
        fill="currentColor"
      />
    </svg>
  );
}
