import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import type { RecordingStatus } from "@school/shared";

import { cn } from "@/lib/utils";
import type { LessonRecordingItem } from "./recordings-api.js";
import { daysLeft, formatBytes, formatDuration, formatRecordingDate } from "./format.js";

/** Страница просмотра записи из кабинета — по уроку, а не через админский `/admin/recordings/:id`. */
export function recordingHref(rec: { id: string; lessonId: string }): string {
  return `/recordings/${rec.lessonId}/${rec.id}`;
}

/** Меньше недели до удаления — предупреждаем, пока запись ещё можно скачать. */
export const EXPIRY_WARN_DAYS = 7;

/** Кадр-заглушка 16:9: у записей нет превью, поэтому тёмная плашка + состояние. */
export function RecordingThumb({
  status,
  durationSec,
  className,
}: {
  status: RecordingStatus;
  durationSec: number | null;
  className?: string;
}) {
  const ready = status === "ready";
  return (
    <div
      className={cn(
        "relative flex aspect-video items-center justify-center bg-foreground text-white",
        status === "failed" && "bg-[#1f1417]",
        (status === "processing" || status === "starting") && "bg-[#1c1a12]",
        className,
      )}
    >
      {ready ? (
        <span className="flex size-11 items-center justify-center rounded-full bg-white/15 transition-colors duration-150 group-hover:bg-white/25">
          <Play className="ml-0.5 size-[18px] fill-current" aria-hidden />
        </span>
      ) : status === "failed" ? (
        <span className="text-[13px] font-semibold text-[#fca5a5]">Запись не сохранилась</span>
      ) : (
        <span className="text-[13px] font-semibold text-[#fde68a]">Обрабатывается…</span>
      )}
      {ready && durationSec != null ? (
        <span className="absolute bottom-2.5 right-2.5 inline-flex h-[22px] items-center rounded-[6px] bg-black/55 px-2 text-xs font-semibold tabular-nums">
          {formatDuration(durationSec)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Карточка записи для кабинета: превью, урок, дата. `detailed` — архив:
 * статус на превью, размер и сколько ещё хранится.
 */
export function RecordingCard({ rec, detailed = false }: { rec: LessonRecordingItem; detailed?: boolean }) {
  const left = daysLeft(rec.expiresAt);
  const soon = left != null && left <= EXPIRY_WARN_DAYS;
  const body = (
    <>
      <RecordingThumb status={rec.status} durationSec={rec.durationSec} />
      <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold text-foreground">{rec.lessonTitle}</span>
          <span className="text-[12.5px] text-muted-foreground">{formatRecordingDate(rec.startedAt)}</span>
        </div>
        {detailed && rec.status === "ready" ? (
          <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatBytes(rec.sizeBytes)}</span>
            {left != null ? (
              <span className={cn(soon && "font-semibold text-[#b45309]")}>
                {soon ? `удалится через ${left} дн.` : `хранится ещё ${left} дн.`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  const frame =
    "group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-[border-color,box-shadow] duration-150 ease-ds";

  // Смотреть можно только готовую запись; остальные — просто карточка состояния.
  return rec.status === "ready" ? (
    <Link
      to={recordingHref(rec)}
      className={cn(frame, "hover:border-primary-muted hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {body}
    </Link>
  ) : (
    <article className={frame}>{body}</article>
  );
}
