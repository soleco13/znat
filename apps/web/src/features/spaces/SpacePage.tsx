import { Link, useParams } from "react-router-dom";
import { Building2, User, Link2Off } from "lucide-react";

import { useAsync } from "@/shared/hooks/use-async";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Button } from "@/shared/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { StatusScreen } from "@/shared/ui/status-screen";
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
    <StatusScreen>
        {info.loading ? (
          <CenteredSpinner label="Загружаем пространство…" />
        ) : info.error || !info.data ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2Off aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Пространство не найдено</EmptyTitle>
              <EmptyDescription>Проверьте адрес ссылки.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {info.data.kind === "organization" ? <Building2 aria-hidden /> : <User aria-hidden />}
              </EmptyMedia>
              <EmptyTitle as="h1">{info.data.name}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild size="lg" className="w-full">
                <Link to="/register">Зарегистрироваться</Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}
    </StatusScreen>
  );
}
