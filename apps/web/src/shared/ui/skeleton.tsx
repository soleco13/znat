import { cn } from "@/lib/utils";

/** Плейсхолдер-заглушка на время загрузки. Форму задаёт className (h-/w-/rounded-). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("animate-pulse rounded-md bg-surface-3", className)} aria-hidden {...props} />
  );
}

export { Skeleton };
