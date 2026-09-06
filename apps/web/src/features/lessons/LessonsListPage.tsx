import { Link } from "react-router-dom";
import { CalendarDays, ArrowRight, Link2, Video } from "lucide-react";
import type { LessonSummary } from "@school/shared";

import { apiFetch } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";

function joinUrl(joinPath: string): string {
  return `${window.location.origin}${joinPath}`;
}

async function copyJoinLink(joinPath: string) {
  try {
    await navigator.clipboard.writeText(joinUrl(joinPath));
    toast.success("Ссылка для учеников скопирована");
  } catch {
    toast.error("Не удалось скопировать ссылку");
  }
}

function LessonRow({ lesson }: { lesson: LessonSummary }) {
  return (
    <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
          <Video className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="block truncate font-semibold text-foreground">{lesson.title}</span>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {lesson.teacherName}
            {lesson.scheduledAt
              ? ` · ${new Date(lesson.scheduledAt).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={() => void copyJoinLink(lesson.joinPath)}>
          <Link2 aria-hidden />
          Ссылка
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link to={`/lessons/${lesson.id}/room`}>
            Войти
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export function LessonsListPage() {
  const { data, error, loading, reload } = useAsync(
    () => apiFetch<{ items: LessonSummary[] }>("/lessons"),
    [],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Уроки" subtitle="Постоянные комнаты уроков и ссылки для учеников" />

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex items-center gap-3.5 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} onRetry={reload} />
      ) : data && data.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.items.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="Уроков пока нет"
          description="Уроки создаёт администратор в разделе «Администрирование»."
        />
      )}
    </div>
  );
}
