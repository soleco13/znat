import { cn } from "@/lib/utils";
import { Loader } from "@/shared/ui/loader";

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
      <Loader className="size-4 text-primary" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Полноблочный лоадер по центру контейнера. */
export function CenteredSpinner({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex min-h-40 w-full items-center justify-center">
      <span role="status" className="inline-flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Loader className="size-8 text-primary" />
        <span>{label}</span>
      </span>
    </div>
  );
}
