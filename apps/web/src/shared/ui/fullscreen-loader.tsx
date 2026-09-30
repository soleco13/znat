import { Loader } from "@/shared/ui/loader";

/** Полноэкранная заставка на время проверки сессии / первичной загрузки приложения. */
export function FullscreenLoader({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
      <Loader className="size-10 text-primary" />
      <p className="text-sm font-medium text-muted-foreground" role="status">
        {label}
      </p>
    </div>
  );
}
