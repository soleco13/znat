import { Link, useParams } from "react-router-dom";
import { Building2, User, Link2Off } from "lucide-react";

import { useAsync } from "@/shared/hooks/use-async";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Button } from "@/shared/ui/button";
import { getSpacePublicInfo } from "@/features/registration/registration-api";

/**
 * Э14.1 — минимальная публичная визитка пространства (`/s/:slug`). Полировка
 * содержимого — отдельный подэтап Э14.4; сейчас достаточно рабочего
 * каркаса: название + тип + переход к регистрации.
 */
export function SpacePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const info = useAsync(() => getSpacePublicInfo(slug), [slug]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg text-center">
        {info.loading ? (
          <CenteredSpinner label="Загружаем пространство…" />
        ) : info.error || !info.data ? (
          <>
            <span className="mx-auto mb-3.5 flex size-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Link2Off className="size-7" aria-hidden />
            </span>
            <h1 className="text-[22px] font-heavy tracking-tight">Пространство не найдено</h1>
            <p className="mt-2 text-sm text-muted-foreground">Проверьте адрес ссылки.</p>
          </>
        ) : (
          <>
            <span className="mx-auto mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              {info.data.kind === "organization" ? (
                <Building2 className="size-7" aria-hidden />
              ) : (
                <User className="size-7" aria-hidden />
              )}
            </span>
            <h1 className="text-[22px] font-heavy tracking-tight">{info.data.name}</h1>
            <Button asChild size="lg" className="mt-6 w-full">
              <Link to="/register">Зарегистрироваться</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
