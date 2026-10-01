import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarDays,
  Clock,
  Download,
  MoreHorizontal,
  Play,
} from "lucide-react";
import type { RecordingWithDownload } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { ErrorState } from "@/shared/ui/error-state";
import { Kbd } from "@/shared/ui/kbd";
import { Loader } from "@/shared/ui/loader";
import { Skeleton } from "@/shared/ui/skeleton";
import { getLesson } from "@/features/lessons/lessons-api.js";
import { EXPIRY_WARN_DAYS, PosterImage, recordingHref } from "./RecordingCard.js";
import { RecordingPlayer } from "./RecordingPlayer.js";
import {
  daysLeft,
  formatBytes,
  formatDuration,
  formatRecordingDate,
  STATUS_LABEL,
} from "./format.js";
import { getLessonRecordings } from "./recordings-api.js";

/** Пока запись обрабатывается, переспрашиваем сервер — видео появится само. */
const PROCESSING_POLL_MS = 15_000;

const SHORTCUTS: [string, string][] = [
  ["Пробел", "пауза"],
  ["← →", "10 секунд"],
  ["S", "скорость"],
  ["M", "звук"],
  ["F", "весь экран"],
];

function timeRange(rec: RecordingWithDownload): string {
  const t = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const day = new Date(rec.startedAt).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  const range = rec.endedAt ? `${t(rec.startedAt)}–${t(rec.endedAt)}` : t(rec.startedAt);
  return `${day[0]!.toUpperCase()}${day.slice(1)} · ${range}`;
}

/** Состояние вместо плеера: обрабатывается / сбой / удалена по сроку. */
function PlayerState({ rec }: { rec: RecordingWithDownload }) {
  const processing = rec.status === "processing" || rec.status === "starting" || rec.status === "recording";
  const expired = rec.status === "deleted";
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-[#0b1220] p-6 text-center text-white">
      {processing ? (
        <Loader className="size-11 text-[#fbbf24]" />
      ) : expired ? (
        <Archive className="size-6 text-[#cbd5e1]" aria-hidden />
      ) : (
        <AlertTriangle className="size-6 text-[#fca5a5]" aria-hidden />
      )}
      <span className="text-lg font-bold tracking-[-0.02em] sm:text-xl">
        {processing
          ? rec.status === "recording"
            ? "Идёт запись урока"
            : "Запись обрабатывается"
          : expired
            ? "Срок хранения истёк"
            : "Запись не сохранилась"}
      </span>
      <span className="max-w-[400px] text-pretty text-sm text-white/70">
        {processing
          ? "Страницу можно не обновлять — видео появится само, когда файл будет готов."
          : expired
            ? "Файл удалён по истечении срока хранения."
            : "Файл записи не был создан."}
      </span>
    </div>
  );
}

/**
 * Просмотр записи из кабинета учителя (макет «Просмотр записи»). Данные —
 * из `GET /lessons/:id/recordings`: он открыт учителю своего урока и сразу
 * даёт соседние записи для колонки «Другие записи урока».
 */
export function LessonRecordingPage() {
  const { lessonId, recordingId } = useParams<{ lessonId: string; recordingId: string }>();
  const backTo = "/recordings";

  const lessonAsync = useAsync(() => getLesson(lessonId!), [lessonId]);
  const recsAsync = useAsync(() => getLessonRecordings(lessonId!), [lessonId]);
  const all = recsAsync.data?.recordings ?? [];
  const rec = all.find((r) => r.id === recordingId) ?? null;
  const others = all.filter((r) => r.id !== recordingId && r.status !== "aborted");

  const processing = rec?.status === "processing" || rec?.status === "starting" || rec?.status === "recording";
  const reloadRecs = recsAsync.reload;
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(reloadRecs, PROCESSING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [processing, reloadRecs]);

  const title = lessonAsync.data?.title ?? "Запись урока";
  const left = rec ? daysLeft(rec.expiresAt) : null;
  const soon = left != null && left <= EXPIRY_WARN_DAYS;
  const loading = recsAsync.loading || lessonAsync.loading;

  return (
    <div className="flex flex-col gap-5 sm:gap-7">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2.5">
          <Link to={backTo}>
            <ArrowLeft aria-hidden />
            Записи
          </Link>
        </Button>
        <span className="flex-1" />
        {rec?.url ? (
          <Button asChild variant="ink" size="sm">
            <a href={rec.url} download>
              <Download aria-hidden />
              <span className="max-sm:sr-only">Скачать · {formatBytes(rec.sizeBytes)}</span>
            </a>
          </Button>
        ) : null}
        {rec ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Ещё">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem asChild>
                <Link to={`/lessons/${lessonId}/room`}>
                  <CalendarDays aria-hidden />
                  Войти в урок
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : recsAsync.error ? (
        <ErrorState description={recsAsync.error} onRetry={recsAsync.reload} />
      ) : !rec ? (
        <ErrorState title="Запись не найдена" description="Возможно, её уже удалили. Вернитесь к списку записей." />
      ) : (
        <div className="flex flex-wrap items-start gap-7">
          <section className="flex min-w-0 flex-[999_1_640px] flex-col gap-[22px]">
            <div className="-mx-4 overflow-hidden bg-[#0b1220] sm:mx-0 sm:rounded-lg sm:shadow-md">
              {rec.status === "ready" && rec.url ? <RecordingPlayer src={rec.url} poster={rec.posterUrl} /> : <PlayerState rec={rec} />}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="text-[22px] font-bold leading-[1.15] tracking-[-0.03em] text-foreground sm:text-[28px]">
                  {title}
                </h1>
                <span className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px] tabular-nums text-muted-foreground">
                  <span className="whitespace-nowrap">{timeRange(rec)}</span>
                  {rec.durationSec != null ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="size-3.5" aria-hidden />
                      {formatDuration(rec.durationSec)}
                    </span>
                  ) : null}
                </span>
              </div>
              {rec.status === "ready" && left != null ? (
                <span
                  className={cn(
                    "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-pill px-3 text-[13px] font-semibold",
                    soon ? "bg-warn-light text-[#b45309]" : "bg-surface-3 text-text-2",
                  )}
                >
                  {soon ? <Clock className="size-3.5" aria-hidden /> : null}
                  {soon
                    ? `Удалится через ${left} дн. — скачайте, если нужна`
                    : `Хранится до ${new Date(rec.expiresAt!).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`}
                </span>
              ) : null}
            </div>

            {rec.status === "ready" ? (
              <div className="hidden flex-wrap gap-x-[18px] gap-y-2 border-t border-border pt-3.5 text-[12.5px] text-muted-foreground lg:flex">
                {SHORTCUTS.map(([key, label]) => (
                  <span key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Kbd>{key}</Kbd>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 lg:sticky lg:top-6">
            <h2 className="text-base font-bold tracking-[-0.02em] text-foreground">Другие записи урока</h2>
            {others.length === 0 ? (
              <p className="text-[13.5px] text-muted-foreground">Других записей у этого урока нет.</p>
            ) : (
              <ul className="-mx-1.5 flex flex-col">
                {others.map((o) => {
                  const ready = o.status === "ready";
                  const row = (
                    <>
                      <span className="relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-foreground text-white">
                        {ready ? <PosterImage src={o.posterUrl} /> : null}
                        <Play className={cn("relative size-3.5 fill-current drop-shadow", !ready && "opacity-40")} aria-hidden />
                        {ready && o.durationSec != null ? (
                          <span className="absolute bottom-1 right-1 rounded-[4px] bg-black/60 px-1 text-[10.5px] font-semibold tabular-nums">
                            {formatDuration(o.durationSec)}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col leading-snug">
                        <span className="text-sm font-semibold text-foreground">{formatRecordingDate(o.startedAt)}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {ready ? formatBytes(o.sizeBytes) : STATUS_LABEL[o.status]}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={o.id}>
                      {ready ? (
                        <Link
                          to={recordingHref(o)}
                          className="flex items-center gap-3 rounded-md p-1.5 transition-colors duration-150 hover:bg-card"
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 p-1.5">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      )}

    </div>
  );
}
