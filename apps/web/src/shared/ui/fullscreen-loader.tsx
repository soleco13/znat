import { Loader2 } from "lucide-react";

/** Полноэкранная заставка на время проверки сессии / первичной загрузки приложения. */
export function FullscreenLoader({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Loader2 className="size-6 animate-spin" aria-hidden />
      </div>
      <p className="text-sm font-medium text-muted-foreground" role="status">
        {label}
      </p>
    </div>
  );
}
