import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Лёгкая «рамка браузера» вокруг макета продукта: точки + адресная строка. */
export function BrowserFrame({
  url = "shkola.online/lessons/algebra-8",
  className,
  children,
}: {
  url?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-xl",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex max-w-[280px] flex-1 items-center gap-1.5 rounded-md bg-card px-2.5 py-1 text-[11px] text-text-3 shadow-xs">
          <Lock className="size-3 text-success" />
          <span className="truncate">{url}</span>
        </div>
        <span className="hidden w-14 sm:block" />
      </div>
      {children}
    </div>
  );
}
