import { AlertTriangle, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";

/** Состояние ошибки загрузки с кнопкой повтора. */
export function ErrorState({
  title = "Не удалось загрузить данные",
  description,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-border bg-card px-8 py-14 text-center",
        className,
      )}
      role="alert"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-md border border-border text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry} loading={retrying}>
          <RotateCcw aria-hidden />
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
