import type { ReactNode } from "react";

/** Карточка по центру экрана — та же, что у входа и регистрации. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-[22px] font-heavy tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
