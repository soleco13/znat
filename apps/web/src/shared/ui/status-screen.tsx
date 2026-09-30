import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Одиночный экран по центру (вход по ссылке, приглашение, «нет доступа»,
 * «вы вышли из урока»): ровный фон и карточка с тонкой рамкой.
 * Содержимое-сообщение — через `Empty` из UI-кита.
 */
export function StatusScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className={cn("w-full max-w-[400px] rounded-lg border border-border bg-card p-8 shadow-xs", className)}>
        {children}
      </div>
    </div>
  );
}
