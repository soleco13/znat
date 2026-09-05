import { Link } from "react-router-dom";
import { CalendarDays, ArrowRight, Radio } from "lucide-react";
import type { LessonResponse } from "@school/shared";

import { apiFetch } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Skeleton } from "@/shared/ui/skeleton";

const STATUS: Record<string, { label: string; variant: "green" | "blue" | "gray" }> = {
  live: { label: "Идёт сейчас", variant: "green" },
  scheduled: { label: "Запланирован", variant: "blue" },
  ended: { label: "Завершён", variant: "gray" },
};

function LessonRow({ lesson }: { lesson: LessonResponse }) {
  const status = STATUS[lesson.status] ?? { label: lesson.status, variant: "gray" as const };
  const joinable = lesson.status === "scheduled" || lesson.status === "live";
  return (
    <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
          {lesson.status === "live" ? (
            <Radio className="size-5 animate-pulse" aria-hidden />
          ) : (
            <CalendarDays className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-foreground">{lesson.title}</span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {lesson.subject} · {new Date(lesson.startsAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>
      {joinable ? (
        <Button asChild size="sm" variant={lesson.status === "live" ? "default" : "secondary"} className="shrink-0">
          <Link to={`/lessons/${lesson.id}/room`}>
            Войти
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      ) : null}
    </Card>
  );
}

export function LessonsListPage() {
  const { data, error, loading, reload } = useAsync(
    () => apiFetch<{ items: LessonResponse[] }>("/lessons"),
    [],
  );

  return (
    <div>
      <PageHeader title="Уроки" subtitle="Расписание и вход в комнату урока" />

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
          description="Здесь появятся запланированные уроки, как только их создадут."
        />
      )}
    </div>
  );
}
