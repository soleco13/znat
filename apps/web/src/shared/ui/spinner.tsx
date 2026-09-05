import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Индикатор загрузки. Для инлайн-состояний и оверлеев. */
export function Spinner({
  className,
  label = "Загрузка…",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Полноблочный лоадер по центру контейнера. */
export function CenteredSpinner({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex min-h-40 w-full items-center justify-center">
      <span role="status" className="inline-flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <span>{label}</span>
      </span>
    </div>
  );
}
